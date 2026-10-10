import { describe, expect, it } from 'vitest';
import { canonicalPlanContent, diffPlans, stableStringify } from './plans';
import { BASE, BASE_POOL, OVERRIDE, commitment, sel } from './test-helpers';
import { reviewAfterEvent, isExpired } from './commitments';
import { feasiblePlans } from './optimizer';
import { constraints } from './test-helpers';

describe('plan versioning content', () => {
  const c1 = commitment({ id: 'C-1', owner: 'ENGINEERING', beneficiary: 'LIFE_SUPPORT', kind: 'RESOURCE_SHARE', resource: 'robot', amount: 4, status: 'OFFERED' });

  it('is stable and ignores commitment status', () => {
    const a = canonicalPlanContent({ selections: sel('L3+M2+F2+E2'), commitments: [c1], policy: BASE, pool: BASE_POOL, reserveRequirements: {} });
    const b = canonicalPlanContent({ selections: sel('L3+M2+F2+E2'), commitments: [{ ...c1, status: 'ACCEPTED' }], policy: BASE, pool: BASE_POOL, reserveRequirements: {} });
    expect(a).toBe(b);
    const changed = canonicalPlanContent({ selections: sel('L2+M2+F2+E3'), commitments: [c1], policy: BASE, pool: BASE_POOL, reserveRequirements: {} });
    expect(changed).not.toBe(a);
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
  });

  it('diffs two versions with resource deltas and cleared votes', () => {
    const prev = { version: 3, selections: sel('L2+M2+F2+E2'), commitmentIds: ['C-1'], policy: BASE, votes: [{} as never, {} as never] };
    const next = { selections: sel('L2+M2+F2+E3'), commitmentIds: ['C-1', 'C-3'], policy: OVERRIDE };
    const d = diffPlans(prev, next);
    expect(d.modeChanges).toHaveLength(1);
    expect(d.modeChanges[0]!.delta).toEqual({ power: -4, water: -1, oxygen: -1, robot: -4, bandwidth: -2 });
    expect(d.summary).toBe('Engineering E2→E3 (P-4 W-1 O-1 R-4 B-2, risk +4) · +C-3 · policy now risk ≤ 28, ≤ 2 Sacrifice · 2 vote(s) cleared');
  });
});

describe('commitment review after an event', () => {
  it('carries affordable shares, marks priorities DUE, withdraws stale offers, fulfils shares whose sacrifice ended', () => {
    const share = commitment({ id: 'C-1', owner: 'ENGINEERING', beneficiary: 'LIFE_SUPPORT', kind: 'RESOURCE_SHARE', resource: 'robot', amount: 4, status: 'ACTIVE', onlyIfSacrificeMode: 'L3', expiry: { unit: 'HOURS', value: 48, label: '48 hours' } });
    const priority = commitment({ id: 'C-2', owner: 'COMMANDER', beneficiary: 'LIFE_SUPPORT', kind: 'PRIORITY', status: 'ACTIVE' });
    const offer = commitment({ id: 'C-3', owner: 'FOOD', beneficiary: 'ENGINEERING', status: 'OFFERED' });
    const rover = { id: 'S1', index: 1, colonyHour: 6, pool: { ...BASE_POOL, robot: 22 }, reserveRequirements: {} };
    const feasible = feasiblePlans(constraints({ robot: 22 }), OVERRIDE);
    const items = reviewAfterEvent([share, priority, offer], rover, feasible);
    expect(items.find((i) => i.id === 'C-1')!.to).toBe('ACTIVE');
    expect(items.find((i) => i.id === 'C-2')!.to).toBe('DUE');
    expect(items.find((i) => i.id === 'C-3')!.to).toBe('WITHDRAWN');
    const water = { id: 'S1', index: 1, colonyHour: 6, pool: { ...BASE_POOL, oxygen: 57 }, reserveRequirements: {} };
    const pathAOnly = feasiblePlans(constraints({ oxygen: 57 }), BASE);
    const shareForE = commitment({ id: 'C-4', owner: 'COMMANDER', beneficiary: 'ENGINEERING', kind: 'RESERVE_ASSIGNMENT', resource: 'water', amount: 2, status: 'ACTIVE', onlyIfSacrificeMode: 'E3', expiry: { unit: 'HOURS', value: 48, label: '48 hours' } });
    expect(reviewAfterEvent([shareForE], water, pathAOnly)[0]!.to).toBe('FULFILLED');
  });

  it('expires by colony hours and by cycles', () => {
    const hours = commitment({ owner: 'COMMANDER', beneficiary: 'ENGINEERING', expiry: { unit: 'HOURS', value: 48, label: '48 hours' } });
    expect(isExpired(hours, 14, 1)).toBe(false);
    expect(isExpired(hours, 60, 2)).toBe(true);
    const cycles = commitment({ owner: 'COMMANDER', beneficiary: 'ENGINEERING', expiry: { unit: 'CYCLES', value: 1, label: 'next cycle' } });
    expect(isExpired(cycles, 0, 1)).toBe(false);
    expect(isExpired(cycles, 0, 2)).toBe(true);
  });
});
