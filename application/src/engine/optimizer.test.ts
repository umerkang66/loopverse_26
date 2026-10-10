import { describe, expect, it } from 'vitest';
import { MODES, SCENARIO } from '@/domain/scenario';
import { DEPARTMENT_IDS } from '@/domain/types';
import { evaluateAll, evaluateCombination, feasiblePlans } from './optimizer';
import { BASE, OVERRIDE, constraints, sel } from './test-helpers';

const keys = (plans: { key: string }[]) => plans.map((p) => p.key).sort();

describe('scenario data', () => {
  it('has 12 frozen packages, one per tier per department, and the PDF pool', () => {
    expect(MODES).toHaveLength(12);
    for (const dept of DEPARTMENT_IDS) {
      expect(MODES.filter((m) => m.department === dept).map((m) => m.tier).sort()).toEqual(['RESTRICTED', 'SACRIFICE', 'STANDARD']);
    }
    expect(SCENARIO.initialPool).toEqual({ power: 79, water: 52, oxygen: 59, robot: 26, bandwidth: 17 });
    expect(Object.isFrozen(SCENARIO)).toBe(true);
    expect(Object.isFrozen(MODES[0]!.resources)).toBe(true);
  });
});

describe('optimizer golden facts (verified by enumeration)', () => {
  it('always evaluates 81 combinations', () => {
    expect(evaluateAll(constraints(), BASE)).toHaveLength(81);
  });

  it('baseline: exactly Path A and Path B under baseline policy', () => {
    expect(keys(feasiblePlans(constraints(), BASE))).toEqual(['L2+M2+F2+E3', 'L3+M2+F2+E2']);
  });

  it('baseline totals match the PDF', () => {
    const a = evaluateCombination(sel('L3+M2+F2+E2'), constraints(), BASE);
    expect(a.totals).toEqual({ power: 79, water: 50, oxygen: 57, robot: 26, bandwidth: 17 });
    expect(a.risk).toBe(24);
    expect(a.reserve).toEqual({ power: 0, water: 2, oxygen: 2, robot: 0, bandwidth: 0 });
    const b = evaluateCombination(sel('L2+M2+F2+E3'), constraints(), BASE);
    expect(b.totals).toEqual({ power: 79, water: 50, oxygen: 59, robot: 26, bandwidth: 16 });
    expect(b.reserve).toEqual({ power: 0, water: 2, oxygen: 0, robot: 0, bandwidth: 1 });
    const std = evaluateCombination(sel('L1+M1+F1+E1'), constraints(), BASE);
    expect(std.totals).toEqual({ power: 112, water: 62, oxygen: 74, robot: 33, bandwidth: 26 });
    expect(std.overages).toEqual({ power: 33, water: 10, oxygen: 15, robot: 7, bandwidth: 9 });
    const restricted = evaluateCombination(sel('L2+M2+F2+E2'), constraints(), BASE);
    expect(restricted.totals).toEqual({ power: 83, water: 51, oxygen: 60, robot: 30, bandwidth: 18 });
    expect(restricted.overages).toEqual({ power: 4, water: 0, oxygen: 1, robot: 4, bandwidth: 1 });
    expect(restricted.risk).toBe(20);
  });

  it('baseline under Crisis Override would allow 7 plans', () => {
    expect(feasiblePlans(constraints(), OVERRIDE)).toHaveLength(7);
  });

  it.each([
    ['Solar aftershock P-4', { power: 75 }, ['L2+M2+F3+E3', 'L3+M2+F2+E3', 'L3+M2+F3+E2']],
    ['Water contamination W-3', { water: 49 }, ['L2+M2+F3+E3', 'L2+M3+F2+E3', 'L3+M2+F2+E3', 'L3+M2+F3+E2', 'L3+M3+F2+E2']],
    ['Secondary O2 leak O-3', { oxygen: 56 }, ['L3+M2+F2+E3', 'L3+M3+F2+E2']],
    ['Rover actuator R-4', { robot: 22 }, ['L3+M2+F2+E3']],
    ['Relay interference B-2', { bandwidth: 15 }, ['L2+M2+F3+E3', 'L2+M3+F2+E3', 'L3+M2+F2+E3']],
  ])('%s: nothing under baseline policy, exact set under override', (_name, pool, expected) => {
    expect(feasiblePlans(constraints(pool), BASE)).toHaveLength(0);
    expect(keys(feasiblePlans(constraints(pool), OVERRIDE))).toEqual(expected);
  });

  it('official sample (Power 55) is infeasible even with override', () => {
    expect(feasiblePlans(constraints({ power: 55 }), BASE)).toHaveLength(0);
    expect(feasiblePlans(constraints({ power: 55 }), OVERRIDE)).toHaveLength(0);
  });

  it('ranks Path A first with no history, Path B first after Life Support sacrificed', () => {
    expect(feasiblePlans(constraints(), BASE)[0]!.key).toBe('L3+M2+F2+E2');
    expect(feasiblePlans(constraints(), BASE, { priorSacrifices: { LIFE_SUPPORT: 1 }, duePriority: [] })[0]!.key).toBe('L2+M2+F2+E3');
  });

  it('event caps bound Crisis Override too, and forbidden modes are respected', () => {
    expect(feasiblePlans(constraints({}, { riskCap: 22 }), OVERRIDE)).toHaveLength(0);
    const forbidden = feasiblePlans(constraints({ robot: 22 }, { forbiddenModes: ['L3'] }), OVERRIDE);
    expect(forbidden).toHaveLength(0);
  });
});
