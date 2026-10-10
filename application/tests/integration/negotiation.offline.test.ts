import { afterEach, describe, expect, it } from 'vitest';
import { SCENARIO } from '@/domain/scenario';
import { computeCompliance } from '@/engine/compliance';
import { injectPreset, keyOf, offlineRuntime, runBaseline } from './helpers';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function fresh(env = {}) {
  const h = await offlineRuntime(env);
  cleanups.push(h.cleanup);
  return h.rt;
}

describe('offline negotiation (rule-based fallback agents, no network)', () => {
  it('baseline: approved in round ≥ 3 with a refusal, two returns, and every baseline compliance item green', async () => {
    const rt = await fresh();
    const s = await runBaseline(rt);
    const S0 = s.scenarios[0]!;
    expect(S0.outcome).toBe('APPROVED');
    expect(S0.round).toBeGreaterThanOrEqual(3);
    expect(['L3+M2+F2+E2', 'L2+M2+F2+E3']).toContain(keyOf(s, S0.approvedPlanVersion));
    expect(s.messages[0]!.from).toBe('COMMANDER');
    expect(s.messages[0]!.type).toBe('BRIEFING');
    expect(s.messages.some((m) => m.subtype === 'SACRIFICE_REFUSAL')).toBe(true);
    expect(s.messages.every((m) => m.source !== 'LLM')).toBe(true);
    const approved = s.plans.find((p) => p.version === S0.approvedPlanVersion)!;
    const returns = s.commitments.filter((c) => approved.commitmentIds.includes(c.id) && c.status === 'ACTIVE');
    expect(new Set(returns.map((c) => c.owner)).size).toBeGreaterThanOrEqual(2);
    const report = computeCompliance(s);
    const baselineFails = report.items.filter((i) => i.scope === 'BASELINE' && i.status !== 'PASS');
    expect(baselineFails).toEqual([]);
    expect(report.items.find((i) => i.id === 'VALIDATOR_BLOCKED')!.status).toBe('PASS');
    expect(report.items.find((i) => i.id === 'APPROVAL_GATE')!.status).toBe('PASS');
  });

  it.each([
    ['PRACTICE_SOLAR', ['L2+M2+F3+E3', 'L3+M2+F2+E3', 'L3+M2+F3+E2']],
    ['PRACTICE_WATER', ['L2+M2+F3+E3', 'L2+M3+F2+E3', 'L3+M2+F2+E3', 'L3+M2+F3+E2', 'L3+M3+F2+E2']],
    ['PRACTICE_OXYGEN', ['L3+M2+F2+E3', 'L3+M3+F2+E2']],
    ['PRACTICE_ROVER', ['L3+M2+F2+E3']],
    ['PRACTICE_RELAY', ['L2+M2+F3+E3', 'L2+M3+F2+E3', 'L3+M2+F2+E3']],
  ])('%s: old plan INVALID, Crisis Override, approval from the override set in round ≥ 2', async (presetId, allowed) => {
    const rt = await fresh();
    await runBaseline(rt);
    const s = await injectPreset(rt, presetId);
    const S1 = s.scenarios[1]!;
    expect(S1.kind).toBe('EVENT');
    expect(S1.previousPlan?.status).toBe('INVALID');
    expect(S1.policy.crisisOverride).toBe(true);
    expect(S1.outcome).toBe('APPROVED');
    expect(S1.round).toBeGreaterThanOrEqual(2);
    expect(allowed).toContain(keyOf(s, S1.approvedPlanVersion));
    const approved = s.plans.find((p) => p.version === S1.approvedPlanVersion)!;
    expect(approved.scenarioId).toBe('S1');
    expect(approved.votes.filter((v) => v.planVersion === approved.version && v.decision === 'ACCEPT')).toHaveLength(4);
    for (const dept of approved.sacrifices) {
      const owners = new Set(s.commitments.filter((c) => approved.commitmentIds.includes(c.id) && c.beneficiary === dept && c.status === 'ACTIVE').map((c) => c.owner));
      expect(owners.size).toBeGreaterThanOrEqual(2);
    }
    const eventItems = computeCompliance(s).items.filter((i) => i.scope === 'EVENT');
    expect(eventItems.filter((i) => i.status !== 'PASS')).toEqual([]);
  });

  it('official sample (Power −30%): INFEASIBLE with a +19 Power request after a one-round hearing', async () => {
    const rt = await fresh();
    await runBaseline(rt);
    const { interpretation, forecast } = await rt.interpretEvent({ kind: 'json', input: SCENARIO.officialSampleEvent });
    expect(forecast.poolAfter.power).toBe(55);
    expect(forecast.feasibleBase + forecast.feasibleOverride).toBe(0);
    await rt.applyEvent(interpretation);
    await rt.waitForIdle();
    const s = rt.getSnapshot();
    const S1 = s.scenarios[1]!;
    expect(S1.outcome).toBe('INFEASIBLE');
    expect(S1.round).toBe(1);
    expect(S1.certificate?.requests[0]).toContain('Power +19');
    const decision = s.messages.find((m) => m.type === 'DECISION' && m.scenarioId === 'S1')!;
    expect(decision.subtype).toBe('INFEASIBLE');
  });

  it('judge-entered Power 60: baseline INFEASIBLE (override unavailable before an event)', async () => {
    const rt = await fresh();
    const s = await runBaseline(rt, { power: 60, water: 52, oxygen: 59, robot: 26, bandwidth: 17 });
    expect(s.scenarios[0]!.outcome).toBe('INFEASIBLE');
    expect(s.scenarios[0]!.certificate?.policyAlternatives[0]!.change).toContain('Crisis Override');
  });

  it('generous pool: approved without any sacrifice; refusal/returns compliance items are NA', async () => {
    const rt = await fresh();
    const s = await runBaseline(rt, { power: 200, water: 200, oxygen: 200, robot: 200, bandwidth: 200 });
    const S0 = s.scenarios[0]!;
    expect(S0.outcome).toBe('APPROVED');
    expect(keyOf(s, S0.approvedPlanVersion)).toBe('L1+M1+F1+E1');
    const items = computeCompliance(s).items;
    expect(items.find((i) => i.id === 'SACRIFICE_REFUSED')!.status).toBe('NA');
    expect(items.find((i) => i.id === 'TWO_RETURNS')!.status).toBe('NA');
  });

  it('max 2 rounds: DEADLOCK with blocking reasons (voting opens in round 3), then Resume approves', async () => {
    const rt = await fresh();
    await rt.start({ maxRounds: 2 });
    await rt.waitForIdle();
    let s = rt.getSnapshot();
    expect(s.scenarios[0]!.outcome).toBe('DEADLOCK');
    const decision = s.messages.find((m) => m.type === 'DECISION' && m.subtype === 'DEADLOCK')!;
    expect(decision).toBeDefined();
    expect(s.messages.some((m) => m.subtype === 'VOTING_DEFERRED')).toBe(true);
    await rt.resume();
    await rt.waitForIdle();
    s = rt.getSnapshot();
    expect(s.scenarios[0]!.outcome).toBe('APPROVED');
    expect(s.scenarios[0]!.round).toBe(3);
  });

  it('reset archives the session; the next start works', async () => {
    const rt = await fresh();
    const first = await runBaseline(rt);
    const { sessionId } = await rt.reset();
    expect(sessionId).not.toBe(first.id);
    const list = await rt.listSessions();
    expect(list.map((e) => e.id)).toContain(first.id);
    const archived = await rt.getSession(first.id);
    expect(archived?.messages.length).toBe(first.messages.length);
    const second = await runBaseline(rt);
    expect(second.scenarios[0]!.outcome).toBe('APPROVED');
  });

  it('persists to the local snapshot and restores on a fresh runtime (crash recovery)', async () => {
    const h = await offlineRuntime();
    cleanups.push(async () => undefined);
    const s = await runBaseline(h.rt);
    await h.rt.persistence.flushNow();
    await h.rt.dispose();
    const { AresRuntime } = await import('@/server/runtime');
    const rt2 = new AresRuntime({ source: {}, env: { mode: 'offline', storageDriver: 'file', STORAGE_DRIVER: 'file', DATA_DIR: h.dir, ARES_INSTANCE_ID: 'test' } });
    await rt2.ready();
    const restored = rt2.getSnapshot();
    expect(restored.id).toBe(s.id);
    expect(restored.messages.length).toBe(s.messages.length);
    expect(restored.scenarios[0]!.outcome).toBe('APPROVED');
    await rt2.dispose();
    await h.cleanup();
  });
});
