import 'server-only';
import { DEPARTMENT_LABEL } from '@/domain/constants';
import type { Commitment, MessageSource, Plan, Scenario, Selections, ValidationReport, ValidationStage } from '@/domain/types';
import { selectionKey, selectionTotals } from '@/engine/catalog';
import { appliesTo, LIVE_STATUSES } from '@/engine/commitments';
import { canonicalPlanContent, diffPlans } from '@/engine/plans';
import { constraintsOf } from '@/engine/policy';
import { capOf, fmtVs, sub } from '@/engine/resources';
import { failedChecks, summarizeReport, validatePlan } from '@/engine/validator';
import type { RunnerDeps } from './deps';
import { plansOf } from './view';

/** Commitments forming the return agreement of `selections`: the model's list (if valid) ∪ every live, applicable offer. */
export function includedCommitments(deps: RunnerDeps, selections: Selections, listed: readonly string[] = []): Commitment[] {
  const s = deps.state();
  const { sacrifices } = selectionTotals(selections);
  const applicable = (c: Commitment) =>
    LIVE_STATUSES.includes(c.status) && c.owner !== c.beneficiary && sacrifices.some((d) => appliesTo(c, d, selections[d]));
  const chosen = new Map<string, Commitment>();
  for (const id of listed) {
    const c = s.commitments.find((x) => x.id === id);
    if (c && applicable(c)) chosen.set(c.id, c);
  }
  for (const c of s.commitments) if (applicable(c)) chosen.set(c.id, c);
  return [...chosen.values()].sort((a, b) => Number(a.id.slice(2)) - Number(b.id.slice(2)));
}

/** A new version only when the content hash changes; otherwise the existing version is reused (and re-validated). */
export function createOrReusePlan(
  deps: RunnerDeps,
  scenario: Scenario,
  round: number,
  selections: Selections,
  opts: { label: string; rationale: string; respondsTo?: string[]; includeIds?: string[]; turnId?: string | null; source?: MessageSource },
): { plan: Plan; created: boolean } {
  const s = deps.state();
  const included = includedCommitments(deps, selections, opts.includeIds);
  const policy = { ...scenario.policy };
  const content = canonicalPlanContent({
    selections,
    commitments: included,
    policy: { ...policy, riskCap: scenario.riskCap, maxSacrificesCap: scenario.maxSacrificesCap } as typeof policy,
    pool: scenario.pool,
    reserveRequirements: scenario.reserveRequirements,
  });
  const hash = deps.sha256(content);
  const existing = plansOf(s, scenario.id);
  const latest = existing[existing.length - 1];
  if (latest && latest.hash === hash && !['STALE', 'INVALID', 'SUPERSEDED'].includes(latest.status)) {
    return { plan: latest, created: false };
  }
  const { totals, risk, sacrifices } = selectionTotals(selections);
  const cap = capOf(scenario.pool, scenario.reserveRequirements);
  const version = deps.mut.nextPlanVersion();
  // The engine assigns versions; drop any "v2 —" the model wrote into its label so v3 never reads as v2.
  const label = opts.label.replace(/^\s*v\d+\s*[—–:-]\s*/i, '').trim() || 'Council plan';
  const plan: Plan = {
    version,
    hash,
    scenarioId: scenario.id,
    round,
    author: 'COMMANDER',
    label,
    selections: { ...selections },
    commitmentIds: included.map((c) => c.id),
    policy,
    poolSnapshot: { ...scenario.pool },
    reserveRequirements: { ...scenario.reserveRequirements },
    totals,
    reserve: sub(cap, totals),
    risk,
    sacrifices,
    status: 'DRAFT',
    statusReason: null,
    rationale: opts.rationale,
    respondsTo: opts.respondsTo ?? [],
    validations: [],
    votes: [],
    diff: null,
    createdAt: deps.now(),
  };
  if (latest && latest.status !== 'APPROVED' && latest.status !== 'RATIFIED') {
    plan.diff = diffPlans(latest, plan);
    if (latest.votes.length) {
      deps.mut.system(scenario, 'VOTES_CLEARED', `Plan changed v${latest.version}→v${version}: ${latest.votes.length} vote(s) cleared`, `Any plan change clears earlier votes. ${plan.diff.summary}`, {
        fromVersion: latest.version,
        toVersion: version,
      });
    }
    deps.mut.setPlanStatus(latest, 'SUPERSEDED', `Superseded by v${version}`);
  }
  deps.mut.addPlan(plan);
  deps.mut.post({
    scenarioId: scenario.id,
    round,
    phase: deps.state().run.phase,
    from: 'COMMANDER',
    type: 'PLAN_DRAFT',
    summary: `Plan v${version} "${label}": ${selectionKey(selections)} → ${fmtVs(totals, cap)} · risk ${risk}${sacrifices.length ? ` · Sacrifice ${sacrifices.map((d) => DEPARTMENT_LABEL[d]).join(', ')}` : ''}`,
    body: opts.rationale,
    planVersion: version,
    turnId: opts.turnId ?? null,
    source: opts.source ?? 'DETERMINISTIC',
    data: {
      version,
      hash,
      label,
      selections: plan.selections,
      totals,
      reserve: plan.reserve,
      risk,
      sacrifices,
      commitmentIds: plan.commitmentIds,
      diff: plan.diff,
      rationale: opts.rationale,
      respondsTo: plan.respondsTo,
    },
  });
  return { plan, created: true };
}

/** Run the deterministic validator on a plan, attach the report, update the status, and post the VALIDATION message. */
export function validateAndRecord(deps: RunnerDeps, scenario: Scenario, plan: Plan, stage: ValidationStage, quiet = false): ValidationReport {
  const s = deps.state();
  const plans = plansOf(s, scenario.id);
  const report = validatePlan({
    selections: plan.selections,
    scenario: { ...constraintsOf(scenario), policy: scenario.policy, colonyHour: scenario.colonyHour, index: scenario.index },
    includedCommitments: s.commitments.filter((c) => plan.commitmentIds.includes(c.id)),
    plan: { version: plan.version, hash: plan.hash, status: plan.status },
    latestVersionInScenario: plans[plans.length - 1]?.version,
    votes: plan.votes,
    stage,
    now: deps.now(),
  });
  deps.mut.addValidation(plan, report);
  if (stage === 'PRE_VOTE') deps.mut.setPlanStatus(plan, report.status === 'PASS' ? 'READY' : 'FAILED', report.status === 'PASS' ? null : failedChecks(report)[0]?.reason ?? null);
  if (!quiet) {
    deps.mut.post({
      scenarioId: scenario.id,
      round: scenario.round,
      phase: 'VALIDATION',
      from: 'VALIDATOR',
      type: 'VALIDATION',
      subtype: report.status,
      summary: `v${plan.version} ${report.stage}: ${summarizeReport(report)}`.slice(0, 400),
      body: report.checks.map((c) => `${c.status === 'PASS' ? '✓' : c.status === 'FAIL' ? '✗' : '–'} ${c.id}: ${c.reason}`).join('\n'),
      planVersion: plan.version,
      data: { report },
      source: 'DETERMINISTIC',
    });
  }
  return report;
}
