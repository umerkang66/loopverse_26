import { SCENARIO } from '@/domain/scenario';
import type { ActivePolicy, ModeId, ResourceVector, Scenario } from '@/domain/types';

/** The parts of a scenario that constrain which combinations are allowed. */
export interface ScenarioConstraints {
  pool: ResourceVector;
  reserveRequirements: Partial<ResourceVector>;
  forbiddenModes: readonly ModeId[];
  riskCap: number | null;
  maxSacrificesCap: number | null;
}

export function basePolicy(): ActivePolicy {
  return {
    riskLimit: SCENARIO.policy.baseRiskLimit,
    maxSacrifices: SCENARIO.policy.baseMaxSacrifices,
    crisisOverride: false,
    requiredReturnCommitments: SCENARIO.policy.requiredReturnCommitments,
  };
}

export function overridePolicy(): ActivePolicy {
  return {
    riskLimit: SCENARIO.policy.crisisOverride.riskLimit,
    maxSacrifices: SCENARIO.policy.crisisOverride.maxSacrifices,
    crisisOverride: true,
    requiredReturnCommitments: SCENARIO.policy.requiredReturnCommitments,
  };
}

/** Informational policy: every department may sacrifice (used only to explain infeasibility). */
export function allSacrificeFloorPolicy(): ActivePolicy {
  return { riskLimit: 36, maxSacrifices: 4, crisisOverride: true, requiredReturnCommitments: SCENARIO.policy.requiredReturnCommitments };
}

/** Event caps are hard caps: they bound every policy, Crisis Override included. */
export function effectiveLimits(
  policy: ActivePolicy,
  constraints: Pick<ScenarioConstraints, 'riskCap' | 'maxSacrificesCap'>,
): { riskLimit: number; maxSacrifices: number } {
  return {
    riskLimit: Math.min(policy.riskLimit, constraints.riskCap ?? Number.POSITIVE_INFINITY),
    maxSacrifices: Math.min(policy.maxSacrifices, constraints.maxSacrificesCap ?? Number.POSITIVE_INFINITY),
  };
}

export function constraintsOf(scenario: Scenario): ScenarioConstraints {
  return {
    pool: scenario.pool,
    reserveRequirements: scenario.reserveRequirements,
    forbiddenModes: scenario.forbiddenModes,
    riskCap: scenario.riskCap,
    maxSacrificesCap: scenario.maxSacrificesCap,
  };
}

/**
 * Crisis Override may be invoked only after an event, and only when no plan fits the baseline limits.
 * Refusing it while a baseline plan exists is a deliberate safety choice.
 */
export function canInvokeOverride(
  scenario: Pick<Scenario, 'kind' | 'overrideAvailable' | 'policy'>,
  feasibleUnderBase: number,
): { allowed: boolean; reason: string } {
  if (scenario.policy.crisisOverride) return { allowed: false, reason: 'Crisis Override is already active.' };
  if (scenario.kind !== 'EVENT' || !scenario.overrideAvailable) {
    return { allowed: false, reason: 'Crisis Override denied: it is only available after an event.' };
  }
  if (feasibleUnderBase > 0) {
    return {
      allowed: false,
      reason: `Crisis Override denied: ${feasibleUnderBase} plan(s) exist under baseline limits.`,
    };
  }
  return { allowed: true, reason: 'No plan fits the baseline limits; Crisis Override authorized.' };
}
