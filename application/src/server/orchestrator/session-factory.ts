import 'server-only';
import { MODES, SCENARIO } from '@/domain/scenario';
import { AGENT_IDS, type AgentId, type AgentState, type SessionConfig, type SessionState } from '@/domain/types';
import type { ServerEnv } from '../env';
import { newSessionId, sha256 } from '../ids';

export function sessionConfigFrom(env: ServerEnv): SessionConfig {
  return {
    mode: env.mode,
    models: {
      commander: env.OPENAI_MODEL_COMMANDER,
      departments: env.OPENAI_MODEL_DEPARTMENTS,
      fallback: env.OPENAI_FALLBACK_MODEL,
      effortCommander: env.OPENAI_REASONING_EFFORT_COMMANDER,
      effortDepartments: env.OPENAI_REASONING_EFFORT_DEPARTMENTS,
    },
    maxRoundsBaseline: env.MAX_ROUNDS_BASELINE,
    maxRoundsEvent: env.MAX_ROUNDS_EVENT,
    baselineDeadlineSec: env.DEADLINE_BASELINE_SECONDS,
    eventDeadlineSec: env.DEADLINE_EVENT_SECONDS,
    modelCallTimeoutMs: env.MODEL_CALL_TIMEOUT_MS,
    agentTurnTimeoutMs: env.AGENT_TURN_TIMEOUT_MS,
    hitl: { enabled: env.HITL_ENABLED, riskThreshold: env.HITL_RISK_THRESHOLD },
  };
}

export function emptyAgentState(id: AgentId): AgentState {
  return {
    id,
    status: 'IDLE',
    requestedMode: null,
    stance: null,
    requestHistory: [],
    stanceHistory: [],
    memory: [],
    sacrificeLedger: [],
    trust: {},
    lastSeenSeq: 0,
    sessionItems: [],
    stats: { llmCalls: 0, fallbacks: 0, totalLatencyMs: 0, inputTokens: 0, outputTokens: 0 },
  };
}

export const CATALOG_SHA256 = sha256(
  JSON.stringify([...MODES].sort((a, b) => a.id.localeCompare(b.id)).map((m) => [m.id, m.resources, m.risk])),
);

export function createSession(env: ServerEnv, now: string): SessionState {
  return {
    id: newSessionId(),
    instanceId: env.ARES_INSTANCE_ID,
    createdAt: now,
    updatedAt: now,
    config: sessionConfigFrom(env),
    scenarioConfigId: SCENARIO.id,
    catalogHash: CATALOG_SHA256,
    scenarios: [],
    events: [],
    plans: [],
    commitments: [],
    messages: [],
    agents: Object.fromEntries(AGENT_IDS.map((id) => [id, emptyAgentState(id)])) as Record<AgentId, AgentState>,
    run: { status: 'IDLE', phase: 'IDLE', scenarioId: null, round: 0, activeAgents: [], startedAt: null, deadlineAt: null, lastError: null },
    planInForceVersion: null,
    counters: { seq: 0, plan: 0, commitment: 0, event: 0, vote: 0, turn: 0 },
  };
}
