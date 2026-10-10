import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AGENT_IDS, DB_TABLES, type DbTable, type SessionState } from '@/domain/types';
import type { SessionListEntry, SessionSummary } from '../store/summary';
import { classifyDbError, DbError } from './errors';
import { fromRows } from './mappers';
import type { InstanceRow, MemoryRow, MessageRow, RowsByTable, SessionRow } from './rows';

const PAGE = 1000; // the Data API returns at most 1,000 rows per request by default

type Result<T> = { data: T | null; error: unknown; status: number };

async function run<T>(table: string, query: PromiseLike<Result<T>>): Promise<T> {
  const { data, error, status } = await query;
  if (error) throw new DbError(classifyDbError(error, status), table);
  return data as T;
}

async function fetchAll<T>(
  sb: SupabaseClient,
  table: DbTable,
  sessionId: string,
  order: string[],
  timeoutMs: number,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = sb.from(table).select('*').eq('session_id', sessionId);
    for (const col of order) query = query.order(col, { ascending: true });
    const page = await run<T[]>(table, query.range(from, from + PAGE - 1).abortSignal(AbortSignal.timeout(timeoutMs)));
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

/** Messages: keyset pagination on seq (O(1) per page). */
async function fetchMessages(sb: SupabaseClient, sessionId: string, timeoutMs: number): Promise<MessageRow[]> {
  const out: MessageRow[] = [];
  let last = -1;
  for (;;) {
    const page = await run<MessageRow[]>(
      'ares_messages',
      sb
        .from('ares_messages')
        .select('*')
        .eq('session_id', sessionId)
        .gt('seq', last)
        .order('seq', { ascending: true })
        .limit(PAGE)
        .abortSignal(AbortSignal.timeout(timeoutMs)),
    );
    out.push(...page);
    if (page.length < PAGE) return out;
    last = page[page.length - 1]!.seq;
  }
}

/** Agent memory: keyset pagination on item_no, per agent. */
async function fetchMemory(sb: SupabaseClient, sessionId: string, timeoutMs: number): Promise<MemoryRow[]> {
  const perAgent = await Promise.all(
    AGENT_IDS.map(async (agentId) => {
      const out: MemoryRow[] = [];
      let last = -1;
      for (;;) {
        const page = await run<MemoryRow[]>(
          'ares_agent_memory',
          sb
            .from('ares_agent_memory')
            .select('*')
            .eq('session_id', sessionId)
            .eq('agent_id', agentId)
            .gt('item_no', last)
            .order('item_no', { ascending: true })
            .limit(PAGE)
            .abortSignal(AbortSignal.timeout(timeoutMs)),
        );
        out.push(...page);
        if (page.length < PAGE) return out;
        last = page[page.length - 1]!.item_no;
      }
    }),
  );
  return perAgent.flat();
}

export async function loadSessionFromDb(sb: SupabaseClient, sessionId: string, timeoutMs: number): Promise<SessionState | null> {
  const session = await run<SessionRow | null>(
    'ares_sessions',
    sb.from('ares_sessions').select('*').eq('id', sessionId).abortSignal(AbortSignal.timeout(timeoutMs)).maybeSingle(),
  );
  if (!session) return null;
  const [scenarios, events, plans, validations, votes, commitments, messages, agentStates, memory] = await Promise.all([
    fetchAll<RowsByTable['ares_scenarios'][number]>(sb, 'ares_scenarios', sessionId, ['idx'], timeoutMs),
    fetchAll<RowsByTable['ares_events'][number]>(sb, 'ares_events', sessionId, ['event_id'], timeoutMs),
    fetchAll<RowsByTable['ares_plans'][number]>(sb, 'ares_plans', sessionId, ['version'], timeoutMs),
    fetchAll<RowsByTable['ares_plan_validations'][number]>(sb, 'ares_plan_validations', sessionId, ['plan_version', 'report_no'], timeoutMs),
    fetchAll<RowsByTable['ares_votes'][number]>(sb, 'ares_votes', sessionId, ['plan_version', 'vote_id'], timeoutMs),
    fetchAll<RowsByTable['ares_commitments'][number]>(sb, 'ares_commitments', sessionId, ['commitment_id'], timeoutMs),
    fetchMessages(sb, sessionId, timeoutMs),
    fetchAll<RowsByTable['ares_agent_states'][number]>(sb, 'ares_agent_states', sessionId, ['agent_id'], timeoutMs),
    fetchMemory(sb, sessionId, timeoutMs),
  ]);
  if (agentStates.length === 0) return null; // a session row without agents was never fully written
  return fromRows({
    ares_sessions: [session],
    ares_scenarios: scenarios,
    ares_events: events,
    ares_plans: plans,
    ares_plan_validations: validations,
    ares_votes: votes,
    ares_commitments: commitments,
    ares_messages: messages,
    ares_agent_states: agentStates,
    ares_agent_memory: memory,
  });
}

export async function readInstance(sb: SupabaseClient, instanceId: string, timeoutMs: number): Promise<InstanceRow | null> {
  return run<InstanceRow | null>(
    'ares_instances',
    sb.from('ares_instances').select('*').eq('instance_id', instanceId).abortSignal(AbortSignal.timeout(timeoutMs)).maybeSingle(),
  );
}

export async function listSessionsFromDb(sb: SupabaseClient, instanceId: string, limit: number, timeoutMs: number): Promise<SessionListEntry[]> {
  const rows = await run<Pick<SessionRow, 'id' | 'created_at' | 'updated_at' | 'status' | 'summary'>[]>(
    'ares_sessions',
    sb
      .from('ares_sessions')
      .select('id, created_at, updated_at, status, summary')
      .eq('instance_id', instanceId)
      .order('created_at', { ascending: false })
      .limit(limit)
      .abortSignal(AbortSignal.timeout(timeoutMs)),
  );
  return rows.map((r) => ({
    id: r.id,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
    status: r.status,
    summary: r.summary as SessionSummary,
  }));
}

/** Hard reset: deletes every session of this instance (children cascade; the instance pointer is nulled). */
export async function deleteInstanceSessions(sb: SupabaseClient, instanceId: string, timeoutMs: number): Promise<void> {
  await run('ares_sessions', sb.from('ares_sessions').delete().eq('instance_id', instanceId).abortSignal(AbortSignal.timeout(timeoutMs)));
}

/** Row counts per table for one session (head-count queries; nothing is transferred). */
export async function headCounts(sb: SupabaseClient, sessionId: string, timeoutMs: number): Promise<Partial<Record<DbTable, number>>> {
  const tables = DB_TABLES.filter((t) => t !== 'ares_instances' && t !== 'ares_sessions');
  const counts = await Promise.all(
    tables.map(async (table) => {
      const { count, error, status } = await sb
        .from(table)
        .select('session_id', { count: 'exact', head: true })
        .eq('session_id', sessionId)
        .abortSignal(AbortSignal.timeout(timeoutMs));
      if (error) throw new DbError(classifyDbError(error, status), table);
      return [table, count ?? 0] as const;
    }),
  );
  return Object.fromEntries([['ares_sessions', 1], ...counts]);
}

export async function countMessages(sb: SupabaseClient, sessionId: string, timeoutMs: number): Promise<number> {
  const { count, error, status } = await sb
    .from('ares_messages')
    .select('seq', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .abortSignal(AbortSignal.timeout(timeoutMs));
  if (error) throw new DbError(classifyDbError(error, status), 'ares_messages');
  return count ?? 0;
}

export type TableCheck = { table: DbTable; ok: boolean; code: string; hint: string };

/** One head request per table: is the migration applied and granted? */
export async function checkSchema(sb: SupabaseClient, timeoutMs: number): Promise<TableCheck[]> {
  return Promise.all(
    DB_TABLES.map(async (table) => {
      const { error, status } = await sb.from(table).select('*', { count: 'exact', head: true }).limit(1).abortSignal(AbortSignal.timeout(timeoutMs));
      if (!error) return { table, ok: true, code: '', hint: '' };
      const c = classifyDbError(error, status);
      return { table, ok: false, code: c.code, hint: c.hint };
    }),
  );
}
