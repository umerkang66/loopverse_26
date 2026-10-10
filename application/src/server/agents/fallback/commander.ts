import 'server-only';
import { DEPARTMENT_LABEL, RESOURCE_LABEL } from '@/domain/constants';
import { PROFILES, referenceReturnsFor } from '@/domain/scenario';
import { RESOURCE_KEYS, type DepartmentId, type Plan, type SessionState, type ValidationReport } from '@/domain/types';
import { sacrificeModeOf } from '@/engine/catalog';
import { affordabilityIssues } from '@/engine/commitments';
import type { RankedPlan } from '@/engine/optimizer';
import { fmt } from '@/engine/resources';
import { failedChecks } from '@/engine/validator';
import { policyLine } from '../packet';
import type { ScenarioView } from '../../orchestrator/view';
import type { BriefingOutput, DecisionOutput, NarrowSelections, SynthesisOutput } from '../schemas';

export function fallbackBriefing(s: SessionState, view: ScenarioView, round: number): BriefingOutput {
  const sc = view.scenario;
  const asks: BriefingOutput['asks'] = [];
  let statement: string;
  if (view.provenInfeasible) {
    statement = `${sc.title}: pool ${fmt(sc.pool)}. Exhaustive search shows no plan fits any policy available to us. ${sc.certificate?.requests[0] ?? ''}`.trim();
    asks.push({ to: 'ALL', ask: 'State your minimum viable package and what external supply you would need.' });
  } else if (sc.kind === 'BASELINE') {
    statement = `${sc.description} Pool ${fmt(sc.pool)}. Policy: ${policyLine(sc)}. ${sc.maxRounds} rounds maximum; voting opens in round ${sc.minRoundsBeforeApproval}.`;
    asks.push({ to: 'ALL', ask: 'Request your Standard package and state what Restricted and Sacrifice would cost you.' });
  } else {
    statement = `EVENT ${sc.title}: pool now ${fmt(sc.pool)}.${sc.previousPlan ? ` Plan v${sc.previousPlan.version} is ${sc.previousPlan.status}.` : ''} Feasible under baseline limits: ${view.feasibleCurrent.length}; with Crisis Override: ${view.feasibleOverride?.length ?? 0}. We renegotiate now.`;
    asks.push({ to: 'ALL', ask: 'Confirm or revise your package under the new pool.' });
    for (const d of view.candidates) asks.push({ to: d, ask: `Would you accept ${sacrificeModeOf(d)}? What return would you need?` });
  }
  return { statement, asks, privateNote: `${sc.id} R${round}: opened with ${view.effectiveFeasible.length} feasible plan(s).` };
}

function refusals(s: SessionState, scenarioId: string, dept: DepartmentId): number {
  return s.agents[dept].stanceHistory.filter((h) => h.scenarioId === scenarioId && h.stance === 'REFUSE').length;
}

function choosePlan(s: SessionState, view: ScenarioView, feasible: RankedPlan[]): RankedPlan {
  const top = feasible[0]!;
  const stubborn = top.sacrifices.filter((d) => refusals(s, view.scenario.id, d) >= 2);
  if (stubborn.length) {
    const alternative = feasible.find((p) => !p.sacrifices.some((d) => stubborn.includes(d)));
    if (alternative) return alternative;
  }
  return top;
}

export function fallbackSynthesis(s: SessionState, view: ScenarioView, round: number, requestedCheck?: ValidationReport): SynthesisOutput {
  const sc = view.scenario;
  const invoke = view.feasibleCurrent.length === 0 && view.overrideWouldBeAllowed;
  const feasible = view.feasibleCurrent.length ? view.feasibleCurrent : invoke ? (view.feasibleOverride ?? []) : [];
  const conflicts = requestedCheck ? failedChecks(requestedCheck).map((c) => `${c.id}: ${c.reason}`) : [];
  const empty = { commanderCommitments: [], responsesToObjections: [], includeCommitmentIds: [] };

  if (feasible.length === 0) {
    return {
      analysis: `No combination fits. ${sc.certificate?.blocking.map((b) => b.detail).join(' ') ?? ''}`.trim(),
      conflicts,
      action: 'DECLARE_INFEASIBLE',
      invokeCrisisOverride: false,
      overrideJustification: '',
      plan: null,
      commanderCommitments: empty.commanderCommitments,
      directives: [{ to: 'ALL', ask: 'Hold minimum packages while we request external supply.' }],
      responsesToObjections: empty.responsesToObjections,
      nextRoundBrief: 'The council is infeasible under every available policy.',
      privateNote: `${sc.id} R${round}: declared infeasible.`,
    };
  }

  const candidates = [...new Set(feasible.flatMap((p) => p.sacrifices))];
  if (sc.kind === 'BASELINE' && round === 1) {
    return {
      analysis: `Requests exceed the pool${conflicts.length ? ` (${conflicts.join('; ')})` : ''}. Even all-Restricted fails; only ${feasible.length} combination(s) fit, each needing a Sacrifice from ${candidates.map((d) => DEPARTMENT_LABEL[d]).join(' or ')}.`,
      conflicts,
      action: 'REQUEST_CHANGES',
      invokeCrisisOverride: false,
      overrideJustification: '',
      plan: null,
      commanderCommitments: [],
      directives: [
        { to: 'ALL', ask: 'Drop to Restricted where the numbers require it and offer returns to whoever may sacrifice.' },
        ...candidates.map((d) => ({ to: d, ask: `Would you accept ${sacrificeModeOf(d)}? What return would you need?` })),
      ],
      responsesToObjections: [],
      nextRoundBrief: `Round ${round + 1}: the feasible paths require ${candidates.map((d) => sacrificeModeOf(d)).join(' or ')}. Candidates, state your stance; others, offer concrete returns.`,
      privateNote: `${sc.id} R${round}: requested concessions; candidates ${candidates.join(', ')}.`,
    };
  }

  const chosen = choosePlan(s, view, feasible);
  const commanderCommitments: SynthesisOutput['commanderCommitments'] = [];
  for (const dept of chosen.sacrifices) {
    const mode = sacrificeModeOf(dept);
    for (const ref of referenceReturnsFor(mode)) {
      if (ref.owner !== 'COMMANDER') continue;
      const exists = s.commitments.some((c) => c.owner === 'COMMANDER' && c.beneficiary === dept && c.promise === ref.promise && ['OFFERED', 'ACCEPTED', 'ACTIVE'].includes(c.status));
      if (exists) continue;
      if (ref.kind === 'RESERVE_ASSIGNMENT' && ref.resource && ref.amount && chosen.reserve[ref.resource] < ref.amount) continue;
      commanderCommitments.push({
        beneficiary: dept,
        kind: ref.kind as 'RESERVE_ASSIGNMENT' | 'PRIORITY' | 'FUTURE_RESOURCE' | 'OTHER',
        resource: ref.resource,
        amount: ref.amount,
        promise: ref.promise,
        expiry: ref.expiry,
        onlyIfSacrificeMode: mode as 'L3' | 'M3' | 'F3' | 'E3',
      });
    }
    // Enhanced compensation when an owed priority promise is broken by necessity.
    if (view.fairness.duePriority.includes(dept)) {
      const r = [...RESOURCE_KEYS].sort((a, b) => chosen.reserve[b] - chosen.reserve[a])[0]!;
      if (chosen.reserve[r] > 0) {
        const amount = Math.min(3, chosen.reserve[r]);
        commanderCommitments.push({
          beneficiary: dept,
          kind: 'RESERVE_ASSIGNMENT',
          resource: r,
          amount,
          promise: `Commander assigns ${amount} reserve ${RESOURCE_LABEL[r].name} units to ${DEPARTMENT_LABEL[dept]} (enhanced return: earlier priority promise cannot be honored)`,
          expiry: { unit: 'HOURS', value: 48, label: '48 hours' },
          onlyIfSacrificeMode: mode as 'L3' | 'M3' | 'F3' | 'E3',
        });
      }
    }
  }
  const directives: SynthesisOutput['directives'] = [];
  for (const dept of chosen.sacrifices) {
    directives.push({ to: dept, ask: `You are designated for ${sacrificeModeOf(dept)}. Accept or decline the returns offered to you.` });
    for (const ref of referenceReturnsFor(sacrificeModeOf(dept))) {
      if (ref.owner !== 'COMMANDER' && ref.owner !== dept) directives.push({ to: ref.owner as DepartmentId, ask: `Offer "${ref.promise}" to ${DEPARTMENT_LABEL[dept]}.` });
    }
  }
  const label = `${chosen.key} — ${chosen.sacrifices.map((d) => DEPARTMENT_LABEL[d]).join(' + ') || 'no'} sacrifice`;
  return {
    analysis: `${invoke ? 'No plan fits baseline limits; invoking Crisis Override. ' : ''}Drafting ${chosen.key} (risk ${chosen.risk}, reserve ${fmt(chosen.reserve)}): ${chosen.why.join('; ')}.`,
    conflicts,
    action: 'DRAFT_PLAN',
    invokeCrisisOverride: invoke,
    overrideJustification: invoke ? `Exhaustive search: 0 plans under baseline limits, ${view.feasibleOverride?.length ?? 0} under Crisis Override.` : '',
    plan: {
      ...(chosen.selections as NarrowSelections),
      label,
      includeCommitmentIds: [],
      rationale: `Rank ${chosen.rank} of ${feasible.length} feasible: ${chosen.why.join('; ')}.`,
    },
    commanderCommitments,
    directives,
    responsesToObjections: [],
    nextRoundBrief: `Plan ${chosen.key} is on the table. ${chosen.sacrifices.map((d) => `${PROFILES[d].callsign} carries ${sacrificeModeOf(d)} with returns`).join('; ')}. Raise numeric objections or prepare to vote.`,
    privateNote: `${sc.id} R${round}: drafted ${chosen.key}.`,
  };
}

export function fallbackDecision(kind: 'APPROVE' | 'DEADLOCK' | 'INFEASIBLE' | 'CONTINUE', plan: Plan | null, report: ValidationReport | null, detail = ''): DecisionOutput {
  if (kind === 'APPROVE' && plan && report) {
    return {
      decision: 'APPROVE',
      statement: `Plan v${plan.version} approved: validator ${report.status} (${report.checks.filter((c) => c.status !== 'SKIP').length} checks), 4/4 ACCEPT. ${plan.sacrifices.length ? `${plan.sacrifices.map((d) => DEPARTMENT_LABEL[d]).join(' and ')} carr${plan.sacrifices.length > 1 ? 'y' : 'ies'} the sacrifice with returns ${plan.commitmentIds.join(', ')}.` : ''}`.trim(),
      privateNote: `Approved v${plan.version}.`,
    };
  }
  if (kind === 'INFEASIBLE') return { decision: 'INFEASIBLE', statement: `INFEASIBLE. ${detail}`.trim(), privateNote: 'Declared infeasible.' };
  if (kind === 'DEADLOCK') return { decision: 'DEADLOCK', statement: `DEADLOCK at the round limit. ${detail}`.trim(), privateNote: 'Deadlock.' };
  return { decision: 'CONTINUE', statement: 'The council continues.', privateNote: 'Continue.' };
}

export function reserveAffordable(plan: Plan, s: SessionState): boolean {
  const included = s.commitments.filter((c) => plan.commitmentIds.includes(c.id));
  return affordabilityIssues(included, plan.selections, plan.reserve).length === 0;
}
