import { describe, expect, it } from 'vitest';
import { reviewAfterEvent } from './commitments';
import { feasiblePlans } from './optimizer';
import { settleAtApproval, clampTrust } from './promises';
import { BASE, BASE_POOL, OVERRIDE, commitment, constraints, sel } from './test-helpers';

const due = (over: Partial<Parameters<typeof commitment>[0]> & { id: string }) =>
  commitment({ owner: 'COMMANDER', beneficiary: 'LIFE_SUPPORT', kind: 'PRIORITY', status: 'DUE', scenarioId: 'S0', ...over });

describe('promises across cycles', () => {
  it('FULFILLED when the beneficiary does not sacrifice', () => {
    const plan = { version: 5, selections: sel('L2+M2+F2+E3'), sacrifices: ['ENGINEERING' as const] };
    const [s] = settleAtApproval([due({ id: 'C-3' })], { id: 'S1' }, plan, [plan]);
    expect(s).toMatchObject({ id: 'C-3', to: 'FULFILLED', trustDelta: 0.2 });
  });

  it('BREACHED and penalised when the sacrifice was avoidable', () => {
    const plan = { version: 5, selections: sel('L3+M2+F2+E2'), sacrifices: ['LIFE_SUPPORT' as const] };
    const alt = { selections: sel('L2+M2+F2+E3') };
    const [s] = settleAtApproval([due({ id: 'C-3' })], { id: 'S1' }, plan, [plan, alt]);
    expect(s).toMatchObject({ to: 'BREACHED', avoidable: true, trustDelta: -0.4 });
  });

  it('BREACHED without a trust penalty when the only feasible plan needs the sacrifice', () => {
    const plan = { version: 5, selections: sel('L3+M2+F2+E3'), sacrifices: ['LIFE_SUPPORT' as const] };
    const [s] = settleAtApproval([due({ id: 'C-3' })], { id: 'S1' }, plan, [plan]);
    expect(s).toMatchObject({ to: 'BREACHED', avoidable: false, trustDelta: 0 });
    expect(s!.reason).toContain('unavoidable — only feasible plan requires L3');
  });

  it('FUTURE_RESOURCE falls due only when the resource increases, then compares tiers', () => {
    const promise = commitment({ id: 'C-9', owner: 'COMMANDER', beneficiary: 'FOOD', kind: 'FUTURE_RESOURCE', resource: 'water', status: 'ACTIVE', expiry: { unit: 'SCENARIOS', value: 3, label: '3 scenarios' } });
    const up = { id: 'S1', index: 1, colonyHour: 6, pool: { ...BASE_POOL, water: 60 }, reserveRequirements: {} };
    const flat = { ...up, pool: BASE_POOL };
    const feasible = feasiblePlans(constraints({ water: 60 }), OVERRIDE);
    expect(reviewAfterEvent([promise], up, feasible, BASE_POOL)[0]).toMatchObject({ to: 'DUE' });
    expect(reviewAfterEvent([promise], flat, feasible, BASE_POOL)[0]).toMatchObject({ to: 'ACTIVE' });
    const worse = { version: 6, selections: sel('L2+M2+F3+E2'), sacrifices: ['FOOD' as const] };
    const earlier = { selections: sel('L2+M2+F2+E2') };
    const [s] = settleAtApproval([{ ...promise, status: 'DUE' }], { id: 'S1' }, worse, [worse], earlier);
    expect(s).toMatchObject({ to: 'BREACHED', avoidable: true });
  });

  it('trust is clamped to [-1, 1]', () => {
    expect(clampTrust(0.9 + 0.2)).toBe(1);
    expect(clampTrust(-0.8 - 0.4)).toBe(-1);
  });

  it('baseline policy sanity (helper import)', () => expect(BASE.riskLimit).toBe(24));
});
