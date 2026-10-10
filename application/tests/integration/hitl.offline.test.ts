import { afterEach, describe, expect, it } from 'vitest';
import { computeCompliance } from '@/engine/compliance';
import { injectPreset, offlineRuntime, runBaseline } from './helpers';

describe('human-in-the-loop countersign (offline agents)', () => {
  let cleanup: (() => Promise<void>) | null = null;
  afterEach(async () => void (await cleanup?.()));

  async function awaitingEvent() {
    const o = await offlineRuntime();
    cleanup = o.cleanup;
    await runBaseline(o.rt);
    const s = await injectPreset(o.rt, 'PRACTICE_SOLAR');
    return { rt: o.rt, s };
  }

  it('holds a plan above the risk threshold for Mission Control, then ratifies on countersign', async () => {
    const { rt, s } = await awaitingEvent();
    const sc = s.scenarios[s.scenarios.length - 1]!;
    const plan = s.plans.find((p) => p.version === sc.approvedPlanVersion)!;
    expect(plan.risk).toBeGreaterThan(s.config.hitl.riskThreshold);
    expect(sc.status).toBe('AWAITING_COUNTERSIGN');
    expect(s.run.status).toBe('AWAITING_COUNTERSIGN');
    expect(computeCompliance(s).items.find((i) => i.id === 'HITL')!.status).toBe('PENDING');

    await rt.countersign('COUNTERSIGN', 'Reviewed.');
    const after = rt.getSnapshot();
    expect(after.plans.find((p) => p.version === plan.version)!.status).toBe('RATIFIED');
    const note = after.messages.find((m) => m.subtype === 'HUMAN_COUNTERSIGN')!;
    expect(note).toMatchObject({ from: 'JUDGE', source: 'HUMAN' });
    expect(computeCompliance(after).items.find((i) => i.id === 'HITL')!.status).toBe('PASS');
    expect(after.run.status).toBe('COMPLETED');
  });

  it('a veto needs a reason, rejects the plan, extends the rounds and renegotiates', async () => {
    const { rt, s } = await awaitingEvent();
    const sc = s.scenarios[s.scenarios.length - 1]!;
    const v = sc.approvedPlanVersion!;
    await expect(rt.countersign('VETO', '  ')).rejects.toThrow(/reason/);
    const before = sc.round;
    await rt.countersign('VETO', 'Too risky for the Engineering crew.');
    await rt.waitForIdle();
    const after = rt.getSnapshot();
    const veto = after.messages.find((m) => m.subtype === 'HUMAN_VETO')!;
    expect(veto).toMatchObject({ type: 'OBJECTION', from: 'JUDGE', source: 'HUMAN' });
    expect(after.messages.filter((m) => m.subtype === 'HITL_REQUIRED').length).toBeGreaterThanOrEqual(2);
    expect(v).toBeGreaterThan(0);
    const latest = after.scenarios.find((x) => x.id === sc.id)!;
    expect(latest.round).toBeGreaterThan(before);
    expect(latest.maxRounds).toBeGreaterThanOrEqual(before + 2);
  });

  it('HITL can be disabled: the same approval resolves without a human', async () => {
    const o = await offlineRuntime({ HITL_ENABLED: false });
    cleanup = o.cleanup;
    await runBaseline(o.rt);
    const s = await injectPreset(o.rt, 'PRACTICE_SOLAR');
    expect(s.scenarios[s.scenarios.length - 1]!.status).toBe('RESOLVED');
    expect(computeCompliance(s).items.find((i) => i.id === 'HITL')!.status).toBe('NA');
  });
});
