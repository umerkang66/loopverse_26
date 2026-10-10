// Shared fixtures for engine tests.
import type { ActivePolicy, Commitment, ResourceVector, Selections } from '@/domain/types';
import { basePolicy, overridePolicy, type ScenarioConstraints } from './policy';

export const BASE_POOL: ResourceVector = { power: 79, water: 52, oxygen: 59, robot: 26, bandwidth: 17 };

export function constraints(pool: Partial<ResourceVector> = {}, extra: Partial<ScenarioConstraints> = {}): ScenarioConstraints {
  return {
    pool: { ...BASE_POOL, ...pool },
    reserveRequirements: {},
    forbiddenModes: [],
    riskCap: null,
    maxSacrificesCap: null,
    ...extra,
  };
}

export const BASE: ActivePolicy = basePolicy();
export const OVERRIDE: ActivePolicy = overridePolicy();

export function sel(key: string): Selections {
  const [LIFE_SUPPORT, MEDICAL, FOOD, ENGINEERING] = key.split('+') as [
    Selections['LIFE_SUPPORT'],
    Selections['MEDICAL'],
    Selections['FOOD'],
    Selections['ENGINEERING'],
  ];
  return { LIFE_SUPPORT, MEDICAL, FOOD, ENGINEERING };
}

let counter = 0;
export function commitment(partial: Partial<Commitment> & Pick<Commitment, 'owner' | 'beneficiary'>): Commitment {
  counter++;
  return {
    id: partial.id ?? `C-${counter}`,
    scenarioId: 'S0',
    round: 2,
    createdAtHour: 0,
    kind: 'PRIORITY',
    resource: null,
    amount: null,
    promise: 'test promise',
    expiry: { unit: 'CYCLES', value: 1, label: 'next cycle' },
    onlyIfSacrificeMode: null,
    status: 'ACCEPTED',
    history: [],
    sourceMessageId: null,
    ...partial,
  };
}

export function scenarioInput(c: ScenarioConstraints, policy: ActivePolicy = BASE, extra: { colonyHour?: number; index?: number } = {}) {
  return { ...c, policy, colonyHour: extra.colonyHour ?? 0, index: extra.index ?? 0 };
}
