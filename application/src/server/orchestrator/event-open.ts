import 'server-only';
import type { Scenario } from '@/domain/types';
import { reviewAfterEvent } from '@/engine/commitments';
import { constraintsOf } from '@/engine/policy';
import { failedChecks, validatePlan } from '@/engine/validator';
import type { RunnerDeps } from './deps';
import { buildView, certificateFor } from './view';

/**
 * Post-event opening (PDF §06 steps 1–3): the event is already recorded; mark the plan in force STALE or
 * INVALID, review return promises, and check whether any plan can exist at all.
 */
export function openEventScenario(deps: RunnerDeps, scenario: Scenario): 'OK' | 'INFEASIBLE_PROVEN' {
  const s = deps.state();
  deps.mut.setPhase('REVIEW');

  // Step 2 · mark the old plan
  const prev = s.planInForceVersion ? s.plans.find((p) => p.version === s.planInForceVersion) : undefined;
  if (prev && prev.scenarioId !== scenario.id && !scenario.previousPlan) {
    const report = validatePlan({
      selections: prev.selections,
      scenario: { ...constraintsOf(scenario), policy: scenario.policy, colonyHour: scenario.colonyHour, index: scenario.index },
      includedCommitments: s.commitments.filter((c) => prev.commitmentIds.includes(c.id)),
      stage: 'DRY_RUN',
      now: deps.now(),
    });
    const broken = failedChecks(report).filter((c) => c.id === 'RESOURCES' || c.id === 'FORBIDDEN_MODES' || c.id === 'RISK_LIMIT' || c.id === 'SACRIFICE_LIMIT');
    const status = broken.length ? 'INVALID' : 'STALE';
    const reasons = broken.length ? broken.map((c) => c.reason) : ['The crisis changed: the plan still fits but needs four fresh votes.'];
    deps.mut.setPlanStatus(prev, status, reasons.join('; '));
    deps.mut.updateScenario(scenario, { previousPlan: { version: prev.version, status, reasons } });
    deps.mut.system(
      scenario,
      status === 'INVALID' ? 'PLAN_INVALID' : 'PLAN_STALE',
      `Plan v${prev.version} is ${status}: ${reasons.join('; ')}`.slice(0, 300),
      reasons.join('\n'),
      { version: prev.version, status, report },
    );
  }

  // Step 3 · review commitments
  const view = buildView(s, scenario);
  const feasibleAll = [...view.feasibleCurrent, ...(view.feasibleOverride ?? [])];
  const items = reviewAfterEvent(s.commitments, scenario, feasibleAll);
  for (const item of items) {
    if (item.from === item.to) continue;
    const c = s.commitments.find((x) => x.id === item.id);
    if (c) deps.mut.setCommitmentStatus(c, item.to, 'SYSTEM', item.reason);
  }
  const changed = items.filter((i) => i.from !== i.to);
  const counts = changed.reduce<Record<string, number>>((acc, i) => ({ ...acc, [i.to]: (acc[i.to] ?? 0) + 1 }), {});
  deps.mut.system(
    scenario,
    'COMMITMENT_REVIEW',
    items.length
      ? `${items.length} commitment(s) reviewed${changed.length ? `: ${Object.entries(counts).map(([k, n]) => `${n} → ${k}`).join(', ')}` : ', all carried'}`
      : 'No earlier commitments to review',
    items.map((i) => `${i.id}: ${i.from} → ${i.to} — ${i.reason}`).join('\n') || 'No commitments were active before this event.',
    { items },
  );

  // Feasibility: is any plan possible under the policies the council may use?
  if (view.provenInfeasible) {
    const record = s.events.find((e) => e.id === scenario.eventId);
    deps.mut.updateScenario(scenario, { certificate: certificateFor(scenario, record?.interpretation.durationHours ?? null) });
    return 'INFEASIBLE_PROVEN';
  }
  return 'OK';
}
