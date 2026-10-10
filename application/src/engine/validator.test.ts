import { describe, expect, it } from 'vitest';
import type { Vote } from '@/domain/types';
import { validatePlan, type ValidateInput } from './validator';
import { BASE, OVERRIDE, commitment, constraints, scenarioInput, sel } from './test-helpers';

const NOW = '2026-10-09T12:00:00.000Z';

function run(partial: Partial<ValidateInput> & Pick<ValidateInput, 'selections'>): ReturnType<typeof validatePlan> {
  return validatePlan({
    scenario: scenarioInput(constraints()),
    includedCommitments: [],
    stage: 'DRY_RUN',
    now: NOW,
    ...partial,
  });
}

const check = (r: ReturnType<typeof validatePlan>, id: string) => r.checks.find((c) => c.id === id)!;

const pathAReturns = () => [
  commitment({ owner: 'ENGINEERING', beneficiary: 'LIFE_SUPPORT', kind: 'RESOURCE_SHARE', resource: 'robot', amount: 4, onlyIfSacrificeMode: 'L3' }),
  commitment({ owner: 'COMMANDER', beneficiary: 'LIFE_SUPPORT', kind: 'PRIORITY' }),
];
const pathBReturns = () => [
  commitment({ owner: 'COMMANDER', beneficiary: 'ENGINEERING', kind: 'RESERVE_ASSIGNMENT', resource: 'water', amount: 2 }),
  commitment({ owner: 'FOOD', beneficiary: 'ENGINEERING', kind: 'PRIORITY', resource: 'water' }),
];

describe('validator', () => {
  it('passes Path A and Path B with two accepted returns from different agents', () => {
    expect(run({ selections: sel('L3+M2+F2+E2'), includedCommitments: pathAReturns() }).status).toBe('PASS');
    expect(run({ selections: sel('L2+M2+F2+E3'), includedCommitments: pathBReturns() }).status).toBe('PASS');
  });

  it('fails all-Standard with all five overages', () => {
    const r = run({ selections: sel('L1+M1+F1+E1') });
    expect(r.status).toBe('FAIL');
    expect(check(r, 'RESOURCES').reason).toBe(
      'Power 112 > 79 (+33) · Water 62 > 52 (+10) · Oxygen 74 > 59 (+15) · Robot time 33 > 26 (+7) · Bandwidth 26 > 17 (+9)',
    );
    expect(check(r, 'RETURN_AGREEMENT').status).toBe('SKIP');
  });

  it('fails all-Restricted on exactly Power, Oxygen, Robot and Bandwidth', () => {
    const r = run({ selections: sel('L2+M2+F2+E2') });
    expect(check(r, 'RESOURCES').reason).toBe('Power 83 > 79 (+4) · Oxygen 60 > 59 (+1) · Robot time 30 > 26 (+4) · Bandwidth 18 > 17 (+1)');
  });

  it('fails two sacrifices under the baseline policy (risk and sacrifice limits)', () => {
    const r = run({ selections: sel('L3+M2+F2+E3') });
    expect(check(r, 'RISK_LIMIT').status).toBe('FAIL');
    expect(check(r, 'RISK_LIMIT').reason).toContain('Risk 28 > limit 24');
    expect(check(r, 'SACRIFICE_LIMIT').reason).toContain('2 Sacrifice modes');
  });

  it('allows two sacrifices under Crisis Override but still needs returns for both', () => {
    const r = run({ selections: sel('L3+M2+F2+E3'), scenario: scenarioInput(constraints({ robot: 22 }), OVERRIDE), includedCommitments: pathAReturns() });
    expect(check(r, 'RISK_LIMIT').status).toBe('PASS');
    expect(check(r, 'RETURN_AGREEMENT').status).toBe('FAIL');
    const both = run({
      selections: sel('L3+M2+F2+E3'),
      scenario: scenarioInput(constraints({ robot: 22 }), OVERRIDE),
      includedCommitments: [...pathAReturns(), ...pathBReturns()],
    });
    expect(both.status).toBe('PASS');
  });

  it('rejects return agreements that do not count', () => {
    const base = { selections: sel('L3+M2+F2+E2') };
    expect(check(run({ ...base, includedCommitments: [] }), 'RETURN_AGREEMENT').status).toBe('FAIL');
    const sameOwner = [
      commitment({ owner: 'ENGINEERING', beneficiary: 'LIFE_SUPPORT' }),
      commitment({ owner: 'ENGINEERING', beneficiary: 'LIFE_SUPPORT' }),
    ];
    expect(check(run({ ...base, includedCommitments: sameOwner }), 'RETURN_AGREEMENT').status).toBe('FAIL');
    const pending = pathAReturns().map((c, i) => (i === 0 ? { ...c, status: 'OFFERED' as const } : c));
    const pendingCheck = check(run({ ...base, includedCommitments: pending }), 'RETURN_AGREEMENT');
    expect(pendingCheck.status).toBe('FAIL');
    expect(pendingCheck.reason).toContain('pending');
    const expired = pathAReturns().map((c) => ({ ...c, expiry: { unit: 'HOURS' as const, value: 1, label: '1 hour' } }));
    expect(check(run({ ...base, includedCommitments: expired, scenario: scenarioInput(constraints(), BASE, { colonyHour: 10 }) }), 'RETURN_AGREEMENT').status).toBe('FAIL');
    const wrongMode = pathAReturns().map((c) => ({ ...c, onlyIfSacrificeMode: 'M3' as const }));
    expect(check(run({ ...base, includedCommitments: wrongMode }), 'RETURN_AGREEMENT').status).toBe('FAIL');
  });

  it('checks commitment affordability against packages and the plan reserve', () => {
    expect(check(run({ selections: sel('L2+M2+F2+E3'), includedCommitments: pathBReturns() }), 'COMMITMENT_AFFORDABILITY').status).toBe('PASS');
    const tooMuch = [
      commitment({ owner: 'COMMANDER', beneficiary: 'ENGINEERING', kind: 'RESERVE_ASSIGNMENT', resource: 'oxygen', amount: 2 }),
      commitment({ owner: 'FOOD', beneficiary: 'ENGINEERING', kind: 'PRIORITY' }),
    ];
    const r = check(run({ selections: sel('L2+M2+F2+E3'), includedCommitments: tooMuch }), 'COMMITMENT_AFFORDABILITY');
    expect(r.status).toBe('FAIL');
    expect(r.reason).toContain('plan reserve is 0');
  });

  it('detects tampered package values', () => {
    const r = run({
      selections: sel('L3+M2+F2+E2'),
      includedCommitments: pathAReturns(),
      claimedPackages: { M2: { resources: { power: 19, water: 10, oxygen: 14, robot: 2, bandwidth: 6 }, risk: 5 } },
    });
    expect(check(r, 'PACKAGE_INTEGRITY').status).toBe('FAIL');
    expect(check(r, 'PACKAGE_INTEGRITY').reason).toContain('M2 claimed power 19 but the published package is 21');
  });

  it('rejects a mode that belongs to another department', () => {
    const r = run({ selections: { ...sel('L3+M2+F2+E2'), FOOD: 'L2' } });
    expect(check(r, 'MODE_SELECTION').status).toBe('FAIL');
    expect(check(r, 'RESOURCES').status).toBe('SKIP');
  });

  it('approval stage needs four ACCEPT votes bound to the exact version and hash', () => {
    const plan = { version: 3, hash: 'abc', status: 'VOTING' as const };
    const vote = (agentId: Vote['agentId'], decision: Vote['decision'] = 'ACCEPT', planVersion = 3, planHash = 'abc'): Vote => ({
      id: `V-${agentId}`,
      agentId,
      planVersion,
      planHash,
      decision,
      reason: 'r',
      conditionsForAccept: [],
      round: 3,
      source: 'LLM',
      createdAt: NOW,
    });
    const base = { selections: sel('L3+M2+F2+E2'), includedCommitments: pathAReturns(), stage: 'APPROVAL' as const, plan, latestVersionInScenario: 3 };
    const all = [vote('LIFE_SUPPORT'), vote('MEDICAL'), vote('FOOD'), vote('ENGINEERING')];
    expect(run({ ...base, votes: all }).status).toBe('PASS');
    expect(check(run({ ...base, votes: [...all.slice(0, 3), vote('ENGINEERING', 'REJECT')] }), 'VOTES').reason).toContain('3/4 ACCEPT');
    expect(check(run({ ...base, votes: [...all.slice(0, 3), vote('ENGINEERING', 'ACCEPT', 2, 'old')] }), 'VOTES').status).toBe('FAIL');
    expect(check(run({ ...base, votes: all, latestVersionInScenario: 4 }), 'PLAN_CURRENCY').status).toBe('FAIL');
  });

  it('warns when an agent claims wrong totals', () => {
    const r = run({
      selections: sel('L3+M2+F2+E2'),
      includedCommitments: pathAReturns(),
      claimedTotals: { agentId: 'ENGINEERING', totals: { power: 78, water: 50, oxygen: 57, robot: 26, bandwidth: 17 } },
    });
    expect(r.status).toBe('PASS');
    expect(r.warnings[0]).toContain('ENGINEERING claimed power 78; actual power 79');
  });

  it('applies event risk caps and reserve requirements', () => {
    const capped = run({ selections: sel('L3+M2+F2+E2'), includedCommitments: pathAReturns(), scenario: scenarioInput(constraints({}, { riskCap: 22 })) });
    expect(check(capped, 'RISK_LIMIT').reason).toContain('Risk 24 > limit 22');
    const reserve = run({
      selections: sel('L3+M2+F2+E2'),
      includedCommitments: pathAReturns(),
      scenario: scenarioInput(constraints({}, { reserveRequirements: { oxygen: 3 } })),
    });
    expect(check(reserve, 'RESOURCES').reason).toContain('Oxygen 57 > 56 (+1)');
  });
});
