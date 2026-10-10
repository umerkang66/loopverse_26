import type { AgentId, AgentStatus, CouncilMessage, Phase, PublicState } from './types';

/** Events on GET /api/stream (Server-Sent Events). Shared by the server bus and the browser. */
export type StreamEvent =
  | { type: 'state.updated'; state: PublicState }
  | { type: 'message.created'; message: CouncilMessage }
  | { type: 'agent.status'; agentId: AgentId; status: AgentStatus; phase: Phase }
  | { type: 'toast'; level: 'info' | 'success' | 'warning' | 'error'; text: string }
  | { type: 'session.reset'; sessionId: string };

export const STREAM_EVENT_TYPES: readonly StreamEvent['type'][] = ['state.updated', 'message.created', 'agent.status', 'toast', 'session.reset'];
