import { describe, expect, it, beforeAll } from 'vitest';
import { setTracingDisabled } from '@openai/agents';
import { ScriptedModel, assistantMessage, modelResponder, modelResponse } from '@openai/agents/testing';
import { AgentFactory } from '@/server/agents/factory';
import { AgentGateway } from '@/server/agents/gateway';
import { AgentSessions } from '@/server/agents/sessions';
import { ballotIssues } from '@/server/agents/guardrails';
import type { BallotOutput } from '@/server/agents/schemas';
import { parseServerEnv } from '@/server/env';
import { makeEngineFacade } from '@/server/orchestrator/engine-facade';
import { createSession } from '@/server/orchestrator/session-factory';

const ballot = (planVersion: number, decision: 'ACCEPT' | 'REJECT' = 'ACCEPT') =>
  JSON.stringify({ planVersion, decision, reason: 'Validator PASS; fair to Life Support.', conditionsForAccept: [], privateNote: 'note' });

function harness(model: ScriptedModel, env: Record<string, unknown> = {}) {
  const serverEnv = parseServerEnv({}, { mode: 'live', OPENAI_API_KEY: 'sk-test-not-real-0000000000', OPENAI_TRACING: 'off', AGENT_TURN_TIMEOUT_MS: 400, MODEL_CALL_TIMEOUT_MS: 400, storageDriver: 'file', ...env });
  const session = createSession(serverEnv, new Date().toISOString());
  const notices: string[] = [];
  const gateway = new AgentGateway(serverEnv, new AgentFactory(serverEnv, model), new AgentSessions(), {
    sessionId: () => session.id,
    sessionItems: (id) => session.agents[id].sessionItems,
    onSessionItems: (id, items) => void (session.agents[id].sessionItems = items),
    onStats: () => undefined,
    onNotice: (_level, text) => void notices.push(text),
  });
  const run = (fallbackVersion = 3) =>
    gateway.run<BallotOutput>({
      agentId: 'LIFE_SUPPORT',
      kind: 'ballot',
      packet: 'BALLOT — vote on v3',
      context: { facade: makeEngineFacade(() => session, 'S0'), agentId: 'LIFE_SUPPORT', scenarioId: 'S0', round: 3, expect: { planVersion: 3 } },
      validate: (o) => ballotIssues(o, 3),
      fallback: () => ({ planVersion: fallbackVersion, decision: 'REJECT', reason: 'fallback', conditionsForAccept: [], privateNote: '' }),
      abortSignal: new AbortController().signal,
    });
  return { run, session, notices };
}

describe('agent gateway (OpenAI Agents SDK with a ScriptedModel, no network)', () => {
  beforeAll(() => setTracingDisabled(true));

  it('returns the LLM output on valid structured JSON and stores the private session', async () => {
    const model = new ScriptedModel([modelResponse([assistantMessage(ballot(3))])]);
    const { run, session } = harness(model);
    const res = await run();
    expect(res.source).toBe('LLM');
    expect(res.output.decision).toBe('ACCEPT');
    expect(res.meta.attempts).toBe(1);
    expect(session.agents.LIFE_SUPPORT.sessionItems.length).toBeGreaterThan(0);
  });

  it('repairs once after invalid JSON, then succeeds', async () => {
    const model = new ScriptedModel([modelResponse([assistantMessage('{not json')]), modelResponse([assistantMessage(ballot(3))])]);
    const res = await harness(model).run();
    expect(res.source).toBe('LLM');
    expect(res.meta.attempts).toBe(2);
  });

  it('repairs a ballot bound to the wrong version (guardrail), then succeeds', async () => {
    const model = new ScriptedModel([modelResponse([assistantMessage(ballot(2))]), modelResponse([assistantMessage(ballot(3))])]);
    const res = await harness(model).run();
    expect(res.source).toBe('LLM');
    expect(res.output.planVersion).toBe(3);
    expect(model.calls[1]!.request.input).toBeDefined();
  });

  it('falls back (labeled) after two invalid outputs', async () => {
    const model = new ScriptedModel([modelResponse([assistantMessage('oops')]), modelResponse([assistantMessage('still not json')])]);
    const res = await harness(model).run();
    expect(res.source).toBe('FALLBACK');
    expect(res.meta.model).toBe('rule-based');
    expect(res.meta.fallbackReason).toMatch(/invalid_output|invalid-output/);
  });

  it('falls back on timeout', async () => {
    const slow = modelResponder(() => new Promise((resolve) => setTimeout(() => resolve([assistantMessage(ballot(3))]), 2000)));
    const model = new ScriptedModel([slow, slow]);
    const res = await harness(model).run();
    expect(res.source).toBe('FALLBACK');
  }, 15_000);

  it('switches every agent to labeled fallback when the key is rejected', async () => {
    const authError = Object.assign(new Error('Incorrect API key provided'), { status: 401, name: 'AuthenticationError' });
    const model = new ScriptedModel([modelResponder(() => Promise.reject(authError))]);
    const h = harness(model);
    const res = await h.run();
    expect(res.source).toBe('FALLBACK');
    expect(h.notices.join(' ')).toContain('rejected the API key');
    const again = await h.run();
    expect(again.meta.fallbackReason).toBe('auth');
  });
});
