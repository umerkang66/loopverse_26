import 'server-only';
import type { DbTable } from '@/domain/types';

// Row shapes of the ares_* tables (supabase/migrations/*_ares_init.sql). jsonb columns are typed loosely and
// re-typed by the mappers; the generated tsvector column `search` is never written.

export interface SessionRow {
  id: string;
  instance_id: string;
  scenario_config_id: string;
  catalog_hash: string;
  mode: 'live' | 'offline';
  status: 'active' | 'archived';
  config: unknown;
  run: unknown;
  counters: unknown;
  plan_in_force_version: number | null;
  summary: unknown;
  created_at: string;
  updated_at: string;
}

export interface InstanceRow {
  instance_id: string;
  current_session_id: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  updated_at: string;
}

export interface ScenarioRow {
  session_id: string;
  scenario_id: string;
  idx: number;
  kind: string;
  title: string;
  status: string;
  outcome: string | null;
  approved_plan_version: number | null;
  started_at: string | null;
  resolved_at: string | null;
  data: unknown;
  updated_at: string;
}

export interface EventRow {
  session_id: string;
  event_id: string;
  scenario_id: string;
  title: string;
  source: string;
  received_at: string;
  pool_before: unknown;
  pool_after: unknown;
  interpretation: unknown;
}

export interface PlanRow {
  session_id: string;
  version: number;
  scenario_id: string;
  round: number;
  hash: string;
  label: string;
  status: string;
  life_support_mode: string;
  medical_mode: string;
  food_mode: string;
  engineering_mode: string;
  risk: number;
  sacrifices: string[];
  commitment_ids: string[];
  totals: unknown;
  reserve: unknown;
  policy: unknown;
  pool_snapshot: unknown;
  diff: unknown;
  rationale: string;
  status_reason: string | null;
  data: unknown;
  created_at: string;
  updated_at: string;
}

export interface ValidationRow {
  session_id: string;
  plan_version: number;
  report_no: number;
  stage: string;
  status: string;
  plan_hash: string | null;
  failed_checks: string[];
  report: unknown;
  evaluated_at: string;
}

export interface VoteRow {
  session_id: string;
  vote_id: string;
  plan_version: number;
  plan_hash: string;
  agent_id: string;
  decision: string;
  reason: string;
  conditions: unknown;
  round: number;
  source: string;
  created_at: string;
}

export interface CommitmentRow {
  session_id: string;
  commitment_id: string;
  scenario_id: string;
  owner: string;
  beneficiary: string;
  kind: string;
  resource: string | null;
  amount: number | null;
  promise: string;
  status: string;
  data: unknown;
  updated_at: string;
}

export interface MessageRow {
  session_id: string;
  seq: number;
  message_id: string;
  scenario_id: string;
  round: number;
  phase: string;
  from_actor: string;
  to_actors: string[];
  type: string;
  subtype: string | null;
  summary: string;
  body: string;
  plan_version: number | null;
  turn_id: string | null;
  source: string;
  model: string | null;
  latency_ms: number | null;
  trace_id: string | null;
  data: unknown;
  meta: unknown;
  created_at: string;
}

export interface AgentStateRow {
  session_id: string;
  agent_id: string;
  state: unknown;
  updated_at: string;
}

export interface MemoryRow {
  session_id: string;
  agent_id: string;
  item_no: number;
  item: unknown;
  created_at: string;
}

export interface RowsByTable {
  ares_sessions: SessionRow[];
  ares_instances: InstanceRow[];
  ares_scenarios: ScenarioRow[];
  ares_events: EventRow[];
  ares_plans: PlanRow[];
  ares_plan_validations: ValidationRow[];
  ares_votes: VoteRow[];
  ares_commitments: CommitmentRow[];
  ares_messages: MessageRow[];
  ares_agent_states: AgentStateRow[];
  ares_agent_memory: MemoryRow[];
}

export type AnyRow = RowsByTable[DbTable][number];

/** Parents before children: satisfies the foreign keys when flushing. */
export const FLUSH_ORDER: readonly DbTable[] = [
  'ares_sessions',
  'ares_instances',
  'ares_scenarios',
  'ares_events',
  'ares_plans',
  'ares_plan_validations',
  'ares_votes',
  'ares_commitments',
  'ares_messages',
  'ares_agent_states',
  'ares_agent_memory',
];

export const ON_CONFLICT: Record<DbTable, string> = {
  ares_sessions: 'id',
  ares_instances: 'instance_id',
  ares_scenarios: 'session_id,scenario_id',
  ares_events: 'session_id,event_id',
  ares_plans: 'session_id,version',
  ares_plan_validations: 'session_id,plan_version,report_no',
  ares_votes: 'session_id,vote_id',
  ares_commitments: 'session_id,commitment_id',
  ares_messages: 'session_id,seq',
  ares_agent_states: 'session_id,agent_id',
  ares_agent_memory: 'session_id,agent_id,item_no',
};

/** Immutable rows: replays use `on conflict do nothing` (idempotent). */
export const APPEND_ONLY: ReadonlySet<DbTable> = new Set<DbTable>([
  'ares_events',
  'ares_plan_validations',
  'ares_votes',
  'ares_messages',
  'ares_agent_memory',
]);
