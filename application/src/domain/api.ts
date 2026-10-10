// Response shapes of the HTTP API, shared by the server routes and the browser client.
import type {
  CouncilMessage,
  DbTable,
  EventEffect,
  EventInterpretation,
  InfeasibilityCertificate,
  PublicState,
  ResourceVector,
  RunState,
  StorageStatus,
} from './types';

export interface StateResponse {
  state: PublicState;
  messages: CouncilMessage[];
}

export interface EventForecast {
  poolBefore: ResourceVector;
  poolAfter: ResourceVector;
  effects: string[];
  feasibleBase: number;
  feasibleOverride: number;
  previousPlanWouldBe: 'STALE' | 'INVALID' | null;
  previousPlanReasons: string[];
  certificate: InfeasibilityCertificate | null;
}

export interface InterpretResponse {
  interpretation: EventInterpretation;
  forecast: EventForecast;
}

export type InterpretRequestBody =
  | { kind: 'preset'; presetId: string }
  | { kind: 'json'; input: unknown }
  | { kind: 'text'; input: string }
  | { kind: 'manual'; title?: string; effects: EventEffect[] };

export interface SessionSummary {
  scenarios: { id: string; kind: string; title: string; outcome: string | null; approvedPlanVersion: number | null; round: number }[];
  messageCount: number;
  planCount: number;
  mode: 'live' | 'offline';
}

export interface SessionListEntry {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'archived';
  summary: SessionSummary;
}

export interface SessionsResponse {
  currentSessionId: string;
  storage: 'supabase' | 'file';
  sessions: SessionListEntry[];
}

export interface SessionResponse extends StateResponse {
  archived: boolean;
}

export interface HealthResponse {
  ok: boolean;
  mode: 'live' | 'offline';
  circuitOpen: boolean;
  models: { commander: string; departments: string; fallback: string };
  modelCheck: Record<string, string>;
  tracing: boolean;
  storage: StorageStatus;
  rowCounts: Partial<Record<DbTable, number>> | null;
  memory: { messages: number; plans: number; votes: number; commitments: number };
  sessionId: string;
  instanceId: string;
  dataDir: string;
  run: RunState;
  judgeCodeRequired: boolean;
  version: string;
}

// ── Cross-session search and insights ──
export interface SearchHit {
  sessionId: string;
  seq: number;
  messageId: string;
  scenarioId: string;
  round: number;
  type: string;
  subtype: string | null;
  from: string;
  planVersion: number | null;
  createdAt: string;
  /** Plain text with «…» markers around matches. Never HTML: render with React text nodes. */
  headline: string;
  rank: number;
  isCurrentSession: boolean;
}

export interface SearchResponse {
  query: string;
  source: 'supabase' | 'local';
  hits: SearchHit[];
}

export interface InsightsResponse {
  sessions: number;
  scenarios_by_outcome: Record<string, number>;
  sacrifices_by_department: Record<string, number>;
  refusals_by_department: Record<string, number>;
  avg_rounds_to_approval: number | null;
  avg_event_resolution_seconds: number | null;
}
