// Exhaustive search over all 81 mode combinations. Advisory for the Commander, decisive only in fallback mode.
import { DEPARTMENT_LABEL } from '@/domain/constants';
import {
  RESOURCE_KEYS,
  type ActivePolicy,
  type DepartmentId,
  type ResourceVector,
  type Selections,
  type SessionState,
} from '@/domain/types';
import { ALL_SELECTIONS, selectionKey, selectionTotals } from './catalog';
import { effectiveLimits, type ScenarioConstraints } from './policy';
import { capOf, fmt, over, sub, total } from './resources';

export type Violation = 'RESOURCES' | 'RISK' | 'SACRIFICES' | 'FORBIDDEN';

export interface CombinationEval {
  key: string; // "L3+M2+F2+E2"
  selections: Selections;
  totals: ResourceVector;
  risk: number;
  sacrifices: DepartmentId[];
  overages: ResourceVector;
  reserve: ResourceVector;
  violations: Violation[];
  feasible: boolean;
}

export function evaluateCombination(
  selections: Selections,
  constraints: ScenarioConstraints,
  policy: ActivePolicy,
): CombinationEval {
  const { totals, risk, sacrifices } = selectionTotals(selections);
  const cap = capOf(constraints.pool, constraints.reserveRequirements);
  const overages = over(totals, cap);
  const limits = effectiveLimits(policy, constraints);
  const violations: Violation[] = [];
  if (total(overages) > 0) violations.push('RESOURCES');
  if (risk > limits.riskLimit) violations.push('RISK');
  if (sacrifices.length > limits.maxSacrifices) violations.push('SACRIFICES');
  if (Object.values(selections).some((m) => constraints.forbiddenModes.includes(m))) violations.push('FORBIDDEN');
  return {
    key: selectionKey(selections),
    selections: { ...selections },
    totals,
    risk,
    sacrifices,
    overages,
    reserve: sub(cap, totals),
    violations,
    feasible: violations.length === 0,
  };
}

export function evaluateAll(constraints: ScenarioConstraints, policy: ActivePolicy): CombinationEval[] {
  return ALL_SELECTIONS.map((selections) => evaluateCombination(selections, constraints, policy));
}

export interface FairnessInput {
  /** How many times each department already took a Sacrifice mode in earlier scenarios. */
  priorSacrifices: Partial<Record<DepartmentId, number>>;
  /** Departments holding an owed (DUE/ACTIVE) "first priority" promise from an earlier scenario. */
  duePriority: DepartmentId[];
}

export interface RankedPlan extends CombinationEval {
  rank: number;
  fairnessPenalty: number;
  why: string[];
}

function minSlackRatio(reserve: ResourceVector, cap: ResourceVector): number {
  return Math.min(...RESOURCE_KEYS.map((key) => (cap[key] > 0 ? reserve[key] / cap[key] : 0)));
}

export function feasiblePlans(
  constraints: ScenarioConstraints,
  policy: ActivePolicy,
  fairness: FairnessInput = { priorSacrifices: {}, duePriority: [] },
): RankedPlan[] {
  const cap = capOf(constraints.pool, constraints.reserveRequirements);
  const scored = evaluateAll(constraints, policy)
    .filter((e) => e.feasible)
    .map((e) => {
      const why: string[] = [];
      let fairnessPenalty = 0;
      for (const dept of e.sacrifices) {
        const prior = fairness.priorSacrifices[dept] ?? 0;
        if (prior > 0) {
          fairnessPenalty += 3 * prior;
          why.push(`${DEPARTMENT_LABEL[dept]} already sacrificed ${prior}× (+${3 * prior})`);
        }
        if (fairness.duePriority.includes(dept)) {
          fairnessPenalty += 5;
          why.push(`${DEPARTMENT_LABEL[dept]} is owed first priority this cycle (+5)`);
        }
      }
      why.unshift(
        e.sacrifices.length
          ? `${e.sacrifices.length} Sacrifice (${e.sacrifices.map((d) => DEPARTMENT_LABEL[d]).join(', ')})`
          : 'no Sacrifice needed',
      );
      why.push(`risk ${e.risk}`, `reserve ${fmt(e.reserve)}`);
      return { ...e, fairnessPenalty, why, slack: minSlackRatio(e.reserve, cap), reserveTotal: total(e.reserve) };
    });
  scored.sort(
    (a, b) =>
      a.sacrifices.length - b.sacrifices.length ||
      a.fairnessPenalty - b.fairnessPenalty ||
      a.risk - b.risk ||
      b.slack - a.slack ||
      b.reserveTotal - a.reserveTotal ||
      a.key.localeCompare(b.key),
  );
  return scored.map(({ slack: _slack, reserveTotal: _reserveTotal, ...rest }, index) => ({ ...rest, rank: index + 1 }));
}

/** Fairness inputs derived from the session: earlier sacrifices and owed priority promises. */
export function fairnessFromState(state: Pick<SessionState, 'agents' | 'commitments'>, currentScenarioId: string): FairnessInput {
  const priorSacrifices: Partial<Record<DepartmentId, number>> = {};
  for (const agent of Object.values(state.agents)) {
    if (agent.id === 'COMMANDER') continue;
    const count = agent.sacrificeLedger.filter((entry) => entry.scenarioId !== currentScenarioId).length;
    if (count > 0) priorSacrifices[agent.id] = count;
  }
  const duePriority = [
    ...new Set(
      state.commitments
        .filter((c) => c.kind === 'PRIORITY' && (c.status === 'DUE' || c.status === 'ACTIVE') && c.scenarioId !== currentScenarioId)
        .map((c) => c.beneficiary),
    ),
  ];
  return { priorSacrifices, duePriority };
}
