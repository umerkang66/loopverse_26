import { describe, expect, it } from 'vitest';
import { certifyInfeasibility, provenInfeasible } from './infeasibility';
import { BASE, OVERRIDE, constraints } from './test-helpers';

const levels = [
  { name: 'baseline limits', policy: BASE },
  { name: 'Crisis Override', policy: OVERRIDE },
];

describe('infeasibility certificate', () => {
  it('official sample (Power 55): +19 Power under override, +24 under baseline, floor needs P67', () => {
    const c = constraints({ power: 55 });
    expect(provenInfeasible(c, levels)).toBe(true);
    const cert = certifyInfeasibility(c, { levels, durationHours: 6 });
    expect(cert.closest[0]!.shortfall).toEqual({ power: 19, water: 0, oxygen: 0, robot: 0, bandwidth: 0 });
    expect(cert.closest[0]!.policy).toBe('Crisis Override');
    expect(cert.requests[0]).toBe('Request Power +19 for 6 h under Crisis Override (closest plan: L2+M2+F3+E3).');
    expect(cert.requests[1]).toContain('Power +24');
    expect(cert.blocking[0]!.detail).toBe('Power: minimum achievable demand 74 (L2+M2+F3+E3) > available 55');
    const floor = cert.policyAlternatives.find((p) => p.change.startsWith('Authorize 3–4'))!;
    expect(floor.feasible).toBe(false);
    expect(floor.detail).toContain('Power +12');
  });

  it('cascade (73/52/57/23/17) misses by only +2 Power', () => {
    const cert = certifyInfeasibility(constraints({ power: 73, oxygen: 57, robot: 23 }), { levels });
    expect(cert.closest[0]!.selections).toEqual({ LIFE_SUPPORT: 'L3', MEDICAL: 'M2', FOOD: 'F2', ENGINEERING: 'E3' });
    expect(cert.closest[0]!.shortfall.power).toBe(2);
  });

  it('a risk cap of 22 blocks every resource-feasible combination; lifting it restores feasibility', () => {
    const c = constraints({}, { riskCap: 22 });
    const cert = certifyInfeasibility(c, { levels });
    const lift = cert.policyAlternatives.find((p) => p.change.startsWith("Lift the event's risk cap"))!;
    expect(lift.feasible).toBe(true);
    expect(lift.detail).toContain('7 feasible plan(s)');
  });

  it('baseline-only levels: Crisis Override is listed as an alternative', () => {
    const cert = certifyInfeasibility(constraints({ power: 60 }), { levels: [{ name: 'baseline limits', policy: BASE }] });
    expect(cert.policyAlternatives[0]!.change).toContain('Invoke Crisis Override');
    expect(cert.requests[0]).toContain('Power');
  });
});
