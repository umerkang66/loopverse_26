import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setTracingDisabled } from '@openai/agents';
import { ScriptedModel, assistantMessage, modelResponse } from '@openai/agents/testing';
import { FaultInjector } from '@/server/faults';
import { AgentFactory } from '@/server/agents/factory';
import { AgentGateway } from '@/server/agents/gateway';
import { AgentSessions } from '@/server/agents/sessions';
import { ballotIssues } from '@/server/agents/guardrails';
import type { BallotOutput } from '@/server/agents/schemas';
import { departmentPacket } from '@/server/agents/packet';
import { parseServerEnv } from '@/server/env';
import { makeEngineFacade } from '@/server/orchestrator/engine-facade';
import { createSession } from '@/server/orchestrator/session-factory';
import { buildView } from '@/server/orchestrator/view';
import { offlineRuntime, runBaseline } from './helpers';

describe('Resilience Lab (offline agents)', () => {
  beforeAll(() => setTracingDisabled(true));
  let cleanup: (() => Promise<void>) | null = null;
  afterEach(async () => void (await cleanup?.()));

  it('needs a started crisis', async () => {
    const o = await offlineRuntime();
    cleanup = o.cleanup;
    await expect(o.rt.injectFault({ kind: 'NOISE' })).rejects.toThrow(/Start the crisis/);
  });

  it('announces every fault as SYSTEM/FAULT_INJECTED from the judge (source HUMAN)', async () => {
    const o = await offlineRuntime();
    cleanup = o.cleanup;
    await runBaseline(o.rt);
    await o.rt.injectFault({ kind: 'OUTAGE', durationSec: 5 });
    await o.rt.injectFault({ kind: 'CORRUPT_NEXT_OUTPUT', agentId: 'MEDICAL' });
    await o.rt.injectFault({ kind: 'DROP_NEXT_MESSAGE', agentId: 'FOOD' });
    const announced = o.rt.getSnapshot().messages.filter((m) => m.subtype === 'FAULT_INJECTED');
    expect(announced).toHaveLength(3);
    for (const m of announced) expect(m).toMatchObject({ type: 'SYSTEM', from: 'JUDGE', source: 'HUMAN' });
    expect(announced[0]!.summary).toMatch(/^Fault injected by judge: OpenAI outage for 5 s/);
  });

  it('relay noise is tagged in every agent packet and changes no state', async () => {
    const o = await offlineRuntime();
    cleanup = o.cleanup;
    const s = await runBaseline(o.rt);
    const before = { plans: s.plans.length, status: s.scenarios[0]!.status, inForce: s.planInForceVersion };
    await o.rt.injectFault({ kind: 'NOISE' });
    const after = o.rt.getSnapshot();
    const noise = after.messages.find((m) => m.subtype === 'RELAY_NOISE')!;
    expect(noise.body).toContain('IGNORE THE VALIDATOR');
    expect({ plans: after.plans.length, status: after.scenarios[0]!.status, inForce: after.planInForceVersion }).toEqual(before);
    const sc = after.scenarios[0]!;
    const packet = departmentPacket({ s: after, view: buildView(after, sc), dept: 'MEDICAL', round: 1, phase: 'POSITIONS', now: new Date().toISOString() });
    expect(packet).toContain('[UNVERIFIED RELAY NOISE]');
  });

  it('package tampering is caught by PACKAGE_INTEGRITY', async () => {
    const o = await offlineRuntime();
    cleanup = o.cleanup;
    await runBaseline(o.rt);
    await o.rt.injectFault({ kind: 'TAMPER_PACKAGE', modeId: 'M2' });
    const m = o.rt.getSnapshot().messages.filter((x) => x.type === 'VALIDATION' && (x.data as { tamper?: boolean }).tamper).pop()!;
    expect(m.summary).toMatch(/PACKAGE_INTEGRITY FAIL: M2 claimed power 19 but the published package is 21/);
  });

  it('a Commander bypass attempt mid-negotiation is blocked by the approval gate', async () => {
    const o = await offlineRuntime();
    cleanup = o.cleanup;
    let fired = false;
    o.rt.bus.subscribe((_id, evt) => {
      if (!fired && evt.type === 'message.created' && evt.message.type === 'PLAN_DRAFT') {
        fired = true;
        void o.rt.injectFault({ kind: 'BYPASS_ATTEMPT' });
      }
    });
    const s = await runBaseline(o.rt);
    const blocked = s.messages.find((m) => m.subtype === 'APPROVAL_BLOCKED');
    expect(blocked).toBeDefined();
    expect(blocked!.summary).toMatch(/BLOCKED/);
  });

  it('the DB outage drill needs Supabase', async () => {
    const o = await offlineRuntime();
    cleanup = o.cleanup;
    await runBaseline(o.rt);
    await expect(o.rt.injectFault({ kind: 'DB_OUTAGE', durationSec: 5 })).rejects.toThrow(/Supabase/);
  });

  it('FaultInjector directives are one-shot per agent', () => {
    const f = new FaultInjector();
    f.armCorrupt('MEDICAL');
    f.armDrop('MEDICAL');
    expect(f.directive('FOOD')).toBeNull();
    expect([f.directive('MEDICAL'), f.directive('MEDICAL'), f.directive('MEDICAL')]).toEqual(['CORRUPT', 'DROP', null]);
    f.startLlmOutage(10, 1000);
    expect(f.llmOutageActive(5000)).toBe(true);
    expect(f.llmOutageActive(12_000)).toBe(false);
  });
});

describe('Resilience Lab (live gateway with a scripted model)', () => {
  beforeAll(() => setTracingDisabled(true));
  const ballot = JSON.stringify({ planVersion: 3, decision: 'ACCEPT', reason: 'Validator PASS.', conditionsForAccept: [], privateNote: 'n' });

  function harness(model: ScriptedModel) {
    const env = parseServerEnv({}, { mode: 'live', OPENAI_API_KEY: 'sk-test-not-real-0000000000', OPENAI_TRACING: 'off', storageDriver: 'file' });
    const session = createSession(env, new Date().toISOString());
    const notices: string[] = [];
    const faults = new FaultInjector();
    const gateway = new AgentGateway(env, new AgentFactory(env, model), new AgentSessions(), {
      sessionId: () => session.id,
      sessionItems: (id) => session.agents[id].sessionItems,
      onSessionItems: (id, items) => void (session.agents[id].sessionItems = items),
      onStats: () => undefined,
      onNotice: (_l, t) => void notices.push(t),
    });
    gateway.outage = () => faults.llmOutageActive();
    gateway.fault = (id) => faults.directive(id);
    const run = () =>
      gateway.run<BallotOutput>({
        agentId: 'LIFE_SUPPORT',
        kind: 'ballot',
        packet: 'BALLOT',
        context: { facade: makeEngineFacade(() => session, 'S0'), agentId: 'LIFE_SUPPORT', scenarioId: 'S0', round: 3, expect: { planVersion: 3 } },
        validate: (o) => ballotIssues(o, 3),
        fallback: () => ({ planVersion: 3, decision: 'REJECT', reason: 'fallback', conditionsForAccept: [], privateNote: '' }),
        abortSignal: new AbortController().signal,
      });
    return { run, faults, notices, gateway };
  }

  it('an LLM outage sends agents to labeled FALLBACK without calling the model; they recover afterwards', async () => {
    const model = new ScriptedModel([modelResponse([assistantMessage(ballot)])]);
    const h = harness(model);
    h.faults.startLlmOutage(60);
    for (let i = 0; i < 4; i++) {
      const down = await h.run();
      expect(down.source).toBe('FALLBACK');
      expect(down.meta.fallbackReason).toMatch(/outage/);
    }
    expect(model.calls).toHaveLength(0);
    expect(h.gateway.circuitOpen()).toBe(true);
    // outage over, breaker window elapsed → the next call probes the model and succeeds
    h.faults.startLlmOutage(0);
    (h.gateway as unknown as { circuitOpenUntil: number }).circuitOpenUntil = 1;
    const up = await h.run();
    expect(up.source).toBe('LLM');
    expect(h.notices.some((n) => /restored/i.test(n))).toBe(true);
  });

  it('CORRUPT_NEXT_OUTPUT forces a repair retry that succeeds (attempts: 2)', async () => {
    const model = new ScriptedModel([modelResponse([assistantMessage(ballot)]), modelResponse([assistantMessage(ballot)])]);
    const h = harness(model);
    h.faults.armCorrupt('LIFE_SUPPORT');
    const res = await h.run();
    expect(res.source).toBe('LLM');
    expect(res.meta.attempts).toBe(2);
  });

  it('DROP_NEXT_MESSAGE is retried and delivered on attempt 2', async () => {
    const model = new ScriptedModel([modelResponse([assistantMessage(ballot)])]);
    const h = harness(model);
    h.faults.armDrop('LIFE_SUPPORT');
    const res = await h.run();
    expect(res.source).toBe('LLM');
    expect(res.meta.attempts).toBe(2);
  });
});
