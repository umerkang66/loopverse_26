import 'server-only';
import {
  DEPARTMENT_IDS,
  type ActivePolicy,
  type Commitment,
  type DepartmentId,
  type Plan,
  type Scenario,
  type SessionState,
} from '@/domain/types';
import { sacrificeModeOf } from '@/engine/catalog';
import { appliesTo, LIVE_STATUSES } from '@/engine/commitments';
import { certifyInfeasibility, provenInfeasible, type PolicyLevel } from '@/engine/infeasibility';
import { fairnessFromState, feasiblePlans, type FairnessInput, type RankedPlan } from '@/engine/optimizer';
import { basePolicy, canInvokeOverride, constraintsOf, overridePolicy, type ScenarioConstraints } from '@/engine/policy';

/** Everything the packets, fallback policies and phases need to know about a scenario, computed once. */
export interface ScenarioView {
  scenario: Scenario;
  constraints: ScenarioConstraints;
  fairness: FairnessInput;
  feasibleCurrent: RankedPlan[];
  /** Feasible under Crisis Override, when it is available but not yet active. */
  feasibleOverride: RankedPlan[] | null;
  /** What the council can realistically pick from now: current policy, else the override set. */
  effectiveFeasible: RankedPlan[];
  overrideWouldBeAllowed: boolean;
  candidates: DepartmentId[];
  levels: PolicyLevel[];
  provenInfeasible: boolean;
  latestPlan: Plan | null;
  planInForce: Plan | null;
}

export function policyLevels(scenario: Scenario): PolicyLevel[] {
  const levels: PolicyLevel[] = [
    { name: scenario.policy.crisisOverride ? 'Crisis Override' : 'baseline limits', policy: scenario.policy },
  ];
  if (scenario.kind === 'EVENT' && scenario.overrideAvailable && !scenario.policy.crisisOverride) {
    levels.push({ name: 'Crisis Override', policy: overridePolicy() });
  }
  return levels;
}

export function buildView(s: SessionState, scenario: Scenario): ScenarioView {
  const constraints = constraintsOf(scenario);
  const fairness = fairnessFromState(s, scenario.id);
  const feasibleCurrent = feasiblePlans(constraints, scenario.policy, fairness);
  const overrideAvailable = scenario.kind === 'EVENT' && scenario.overrideAvailable && !scenario.policy.crisisOverride;
  const feasibleOverride = overrideAvailable ? feasiblePlans(constraints, overridePolicy(), fairness) : null;
  const overrideWouldBeAllowed = canInvokeOverride(scenario, feasibleCurrent.length).allowed && (feasibleOverride?.length ?? 0) > 0;
  const effectiveFeasible = feasibleCurrent.length ? feasibleCurrent : overrideWouldBeAllowed ? feasibleOverride! : [];
  // A department is a sacrifice candidate only if a sacrifice is actually NEEDED: it appears in a plan with the
  // minimum number of Sacrifice modes (a generous pool needs none, so nobody is asked to sacrifice).
  const minSacrifices = effectiveFeasible.length ? Math.min(...effectiveFeasible.map((p) => p.sacrifices.length)) : 0;
  const candidates =
    minSacrifices === 0
      ? []
      : DEPARTMENT_IDS.filter((d) => effectiveFeasible.some((p) => p.sacrifices.length === minSacrifices && p.sacrifices.includes(d)));
  const levels = policyLevels(scenario);
  const plans = s.plans.filter((p) => p.scenarioId === scenario.id);
  return {
    scenario,
    constraints,
    fairness,
    feasibleCurrent,
    feasibleOverride,
    effectiveFeasible,
    overrideWouldBeAllowed,
    candidates,
    levels,
    provenInfeasible: provenInfeasible(constraints, levels),
    latestPlan: plans[plans.length - 1] ?? null,
    planInForce: s.planInForceVersion ? (s.plans.find((p) => p.version === s.planInForceVersion) ?? null) : null,
  };
}

export function certificateFor(scenario: Scenario, durationHours: number | null = null) {
  return certifyInfeasibility(constraintsOf(scenario), { levels: policyLevels(scenario), durationHours });
}

/** Live commitments that would count for `dept` taking its Sacrifice mode. */
export function offersTo(s: SessionState, dept: DepartmentId, modeId = sacrificeModeOf(dept)): Commitment[] {
  return s.commitments.filter((c) => LIVE_STATUSES.includes(c.status) && appliesTo(c, dept, modeId) && c.owner !== dept);
}

export function distinctOwners(commitments: readonly Commitment[]): number {
  return new Set(commitments.map((c) => c.owner)).size;
}

export function basePolicyFor(): ActivePolicy {
  return basePolicy();
}

export function plansOf(s: SessionState, scenarioId: string): Plan[] {
  return s.plans.filter((p) => p.scenarioId === scenarioId);
}
