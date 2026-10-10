import 'server-only';
import type { AgentId, SessionState } from '@/domain/types';
import type { AgentGateway } from '../agents/gateway';
import type { AgentRunContext } from '../agents/context';
import type { ServerEnv } from '../env';
import { makeEngineFacade } from './engine-facade';
import type { Mutations } from './mutations';

export interface RunnerDeps {
  state(): SessionState;
  mut: Mutations;
  gateway: AgentGateway;
  env: ServerEnv;
  now(): string;
  sha256(text: string): string;
}

/** Signals for one scenario run: `abort` = hard stop (reset/new event); `deadline` = soft stop (fallback, then TIMEOUT). */
export interface RunSignals {
  abort: AbortSignal;
  deadline: AbortSignal;
}

export function agentContext(deps: RunnerDeps, agentId: AgentId, scenarioId: string, round: number, expect: AgentRunContext['expect'] = {}): AgentRunContext {
  return { facade: makeEngineFacade(deps.state, scenarioId), agentId, scenarioId, round, expect };
}

export class AbortedError extends Error {
  constructor() {
    super('Negotiation aborted');
    this.name = 'AbortError';
  }
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new AbortedError();
}
