import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { InsightsResponse, SearchHit, SearchResponse } from '@/domain/api';
import type { SessionState } from '@/domain/types';

const MARK_OPEN = '«';
const MARK_CLOSE = '»';

const terms = (query: string): string[] =>
  [...query.matchAll(/"([^"]+)"|(\S+)/g)]
    .map((m) => (m[1] ?? m[2] ?? '').toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((t) => t.length > 0);

/** Plain snippet around the first hit, with «…» markers (same convention as ts_headline in the SQL function). */
export function headlineFor(text: string, words: readonly string[]): string {
  const lower = text.toLowerCase();
  const at = Math.min(...words.map((w) => lower.indexOf(w)).filter((i) => i >= 0));
  const start = Number.isFinite(at) ? Math.max(0, at - 50) : 0;
  let snippet = text.slice(start, start + 160);
  for (const w of words) snippet = snippet.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => `${MARK_OPEN}${m}${MARK_CLOSE}`);
  return `${start > 0 ? '…' : ''}${snippet}${start + 160 < text.length ? '…' : ''}`.replace(/\s+/g, ' ');
}

/** File-mode search over the current session and the local archive; same shape as the SQL function's rows. */
export function searchSessions(sessions: readonly SessionState[], currentSessionId: string, query: string, limit: number): SearchHit[] {
  const words = terms(query);
  if (words.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const s of sessions) {
    for (const m of s.messages) {
      const text = `${m.summary} — ${m.body}`;
      const lower = text.toLowerCase();
      if (!words.every((w) => lower.includes(w))) continue;
      const score = words.reduce((n, w) => n + lower.split(w).length - 1, 0) / Math.max(1, Math.sqrt(text.length));
      hits.push({
        sessionId: s.id,
        seq: m.seq,
        messageId: m.id,
        scenarioId: m.scenarioId,
        round: m.round,
        type: m.type,
        subtype: m.subtype,
        from: m.from,
        planVersion: m.planVersion,
        createdAt: m.createdAt,
        headline: headlineFor(text, words),
        rank: Math.round(score * 1000) / 1000,
        isCurrentSession: s.id === currentSessionId,
      });
    }
  }
  return hits.sort((a, b) => b.rank - a.rank || b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

/** Same aggregates as `public.ares_insights`, computed in memory. */
export function insightsFromSessions(sessions: readonly SessionState[]): InsightsResponse {
  const count = (acc: Record<string, number>, key: string) => void (acc[key] = (acc[key] ?? 0) + 1);
  const outcomes: Record<string, number> = {};
  const sacrifices: Record<string, number> = {};
  const refusals: Record<string, number> = {};
  const rounds: number[] = [];
  const eventSeconds: number[] = [];
  for (const s of sessions) {
    for (const sc of s.scenarios) {
      if (sc.outcome) count(outcomes, sc.outcome);
      if (sc.outcome === 'APPROVED') rounds.push(sc.round);
      const plan = sc.approvedPlanVersion ? s.plans.find((p) => p.version === sc.approvedPlanVersion) : undefined;
      for (const dept of plan?.sacrifices ?? []) count(sacrifices, dept);
      if (sc.kind === 'EVENT' && sc.startedAt && sc.resolvedAt) eventSeconds.push((Date.parse(sc.resolvedAt) - Date.parse(sc.startedAt)) / 1000);
    }
    for (const m of s.messages) if (m.subtype === 'SACRIFICE_REFUSAL') count(refusals, m.from);
  }
  const avg = (xs: number[], digits: number) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10 ** digits) / 10 ** digits : null);
  return {
    sessions: sessions.length,
    scenarios_by_outcome: outcomes,
    sacrifices_by_department: sacrifices,
    refusals_by_department: refusals,
    avg_rounds_to_approval: avg(rounds, 2),
    avg_event_resolution_seconds: avg(eventSeconds, 1),
  };
}

interface SearchRow {
  session_id: string;
  seq: number;
  message_id: string;
  scenario_id: string;
  round: number;
  type: string;
  subtype: string | null;
  from_actor: string;
  plan_version: number | null;
  created_at: string;
  headline: string;
  rank: number;
}

export async function searchRemote(sb: SupabaseClient, instanceId: string, query: string, limit: number, currentSessionId: string, timeoutMs: number): Promise<SearchHit[]> {
  const { data, error } = await sb
    .rpc('ares_search_messages', { p_query: query, p_instance: instanceId, p_limit: limit })
    .abortSignal(AbortSignal.timeout(timeoutMs));
  if (error) throw new Error(error.message);
  return ((data ?? []) as SearchRow[]).map((r) => ({
    sessionId: r.session_id,
    seq: r.seq,
    messageId: r.message_id,
    scenarioId: r.scenario_id,
    round: r.round,
    type: r.type,
    subtype: r.subtype,
    from: r.from_actor,
    planVersion: r.plan_version,
    createdAt: r.created_at,
    headline: r.headline,
    rank: r.rank,
    isCurrentSession: r.session_id === currentSessionId,
  }));
}

export async function insightsRemote(sb: SupabaseClient, instanceId: string, timeoutMs: number): Promise<InsightsResponse> {
  const { data, error } = await sb.rpc('ares_insights', { p_instance: instanceId }).abortSignal(AbortSignal.timeout(timeoutMs));
  if (error) throw new Error(error.message);
  return data as InsightsResponse;
}

export type { SearchResponse };
