'use client';

import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import type { InsightsResponse } from '@/domain/api';
import { AGENT_IDS, DEPARTMENT_IDS, MESSAGE_TYPES, type CouncilMessage, type PublicState } from '@/domain/types';
import { TIER_RANK, tierOf } from '@/engine/catalog';
import { api } from '@/client/api';
import { useAres } from '@/client/store';
import { ACTOR_META, MESSAGE_TYPE_META } from '@/client/theme';
import { Empty } from '../bits';

const TIER_NAME: Record<number, string> = { 3: 'Standard', 2: 'Restricted', 1: 'Sacrifice' };

function concessionData(state: PublicState) {
  const points = new Map<string, Record<string, number | string>>();
  const order = (scenarioId: string, round: number) => (state.scenarios.find((s) => s.id === scenarioId)?.index ?? 0) * 100 + round;
  for (const d of DEPARTMENT_IDS) {
    for (const h of state.agents[d].requestHistory) {
      const key = `${h.scenarioId} R${h.round}`;
      const p = points.get(key) ?? { key, order: order(h.scenarioId, h.round) };
      p[d] = TIER_RANK[tierOf(h.modeId)];
      points.set(key, p);
    }
  }
  return [...points.values()].sort((a, b) => (a.order as number) - (b.order as number));
}

function latencies(messages: CouncilMessage[]) {
  const seen = new Set<string>();
  const by = new Map<string, number[]>();
  for (const m of messages) {
    if (m.source !== 'LLM' || !m.meta) continue;
    const key = m.turnId ?? m.id;
    if (seen.has(key)) continue;
    seen.add(key);
    by.set(m.from, [...(by.get(m.from) ?? []), m.meta.latencyMs]);
  }
  return by;
}

function roundDurations(messages: CouncilMessage[]) {
  const by = new Map<string, { first: number; last: number }>();
  for (const m of messages) {
    if (m.round === 0) continue;
    const key = `${m.scenarioId} R${m.round}`;
    const t = Date.parse(m.createdAt);
    const cur = by.get(key);
    by.set(key, cur ? { first: Math.min(cur.first, t), last: Math.max(cur.last, t) } : { first: t, last: t });
  }
  return [...by.entries()].map(([key, v]) => ({ key, seconds: (v.last - v.first) / 1000 }));
}

export function AnalyticsPanel() {
  const state = useAres((s) => s.state);
  const messages = useAres((s) => s.messages);
  const data = useMemo(() => (state ? concessionData(state) : []), [state]);
  const lat = useMemo(() => latencies(messages), [messages]);
  const rounds = useMemo(() => roundDurations(messages), [messages]);
  if (!state) return null;
  if (messages.length === 0) return <Empty>Analytics appear once the council is running.</Empty>;
  const byType = MESSAGE_TYPES.map((t) => ({ t, n: messages.filter((m) => m.type === t).length })).filter((x) => x.n > 0);
  const maxType = Math.max(1, ...byType.map((x) => x.n));
  return (
    <div className="flex flex-col gap-4">
      <InsightsCard />
      <section className="flex flex-col gap-1">
        <h3 className="panel-title">Concessions — requested tier per round</h3>
        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid stroke="#1E2630" strokeDasharray="3 3" />
              <XAxis dataKey="key" tick={{ fill: '#8A97A8', fontSize: 10 }} />
              <YAxis domain={[0.5, 3.5]} ticks={[1, 2, 3]} tickFormatter={(v: number) => TIER_NAME[v] ?? ''} tick={{ fill: '#8A97A8', fontSize: 10 }} width={64} />
              <ChartTooltip
                contentStyle={{ background: '#131820', border: '1px solid #1E2630', fontSize: 12 }}
                formatter={(value, name) => [TIER_NAME[Number(value)] ?? value, ACTOR_META[name as keyof typeof ACTOR_META]?.callsign ?? name]}
              />
              {DEPARTMENT_IDS.map((d) => (
                <Line key={d} type="stepAfter" dataKey={d} stroke={ACTOR_META[d].color} strokeWidth={2} dot={{ r: 2 }} connectNulls isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[11px] text-muted-foreground">A step down means a department conceded to a cheaper mode; flat lines show who held its ground.</p>
      </section>
      <section className="flex flex-col gap-1">
        <h3 className="panel-title">Messages by type</h3>
        {byType.map(({ t, n }) => (
          <div key={t} className="grid grid-cols-[96px_1fr_32px] items-center gap-2 text-xs">
            <span className="text-muted-foreground">{MESSAGE_TYPE_META[t].label}</span>
            <div className="h-2 rounded-sm bg-panel-2">
              <div className="h-2 rounded-sm bg-mars/70" style={{ width: `${(n / maxType) * 100}%` }} />
            </div>
            <span className="num text-right">{n}</span>
          </div>
        ))}
      </section>
      <section className="flex flex-col gap-1">
        <h3 className="panel-title">Agents — model latency and fallbacks</h3>
        <table className="num w-full text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="text-left font-normal">Agent</th>
              <th className="text-right font-normal">msgs</th>
              <th className="text-right font-normal">LLM calls</th>
              <th className="text-right font-normal">avg</th>
              <th className="text-right font-normal">p95</th>
              <th className="text-right font-normal">fallback</th>
            </tr>
          </thead>
          <tbody>
            {AGENT_IDS.map((id) => {
              const v = [...(lat.get(id) ?? [])].sort((a, b) => a - b);
              const avg = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
              const p95 = v.length ? v[Math.min(v.length - 1, Math.floor(v.length * 0.95))]! : null;
              return (
                <tr key={id}>
                  <td style={{ color: ACTOR_META[id].color }}>{ACTOR_META[id].callsign}</td>
                  <td className="text-right">{messages.filter((m) => m.from === id).length}</td>
                  <td className="text-right">{state.agents[id].stats.llmCalls}</td>
                  <td className="text-right">{avg === null ? '—' : `${(avg / 1000).toFixed(1)}s`}</td>
                  <td className="text-right">{p95 === null ? '—' : `${(p95 / 1000).toFixed(1)}s`}</td>
                  <td className={state.agents[id].stats.fallbacks ? 'text-right text-amber' : 'text-right'}>{state.agents[id].stats.fallbacks}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <section className="flex flex-col gap-1">
        <h3 className="panel-title">Round durations</h3>
        <div className="flex flex-wrap gap-1.5">
          {rounds.map((r) => (
            <span key={r.key} className="num rounded-[6px] border bg-panel-2 px-1.5 py-0.5 text-[11px]">
              {r.key}: {r.seconds.toFixed(1)}s
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}

function InsightsCard() {
  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api
      .insights()
      .then((data) => {
        if (active) {
          setInsights(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading || !insights || insights.sessions === 0) return null;

  const sacrifices = Object.entries(insights.sacrifices_by_department)
    .filter(([, n]) => n > 0)
    .map(([dept, n]) => `${ACTOR_META[dept as keyof typeof ACTOR_META]?.callsign ?? dept} sacrificed ${n}×`);

  const totalRefusals = Object.values(insights.refusals_by_department).reduce((a, b) => a + b, 0);

  return (
    <section className="flex flex-col gap-1.5 rounded-lg border border-info/40 bg-info/5 p-3 text-xs">
      <div className="flex items-center justify-between">
        <h3 className="panel-title text-info">Cross-session history insights</h3>
        <span className="num text-muted-foreground">{insights.sessions} session{insights.sessions === 1 ? '' : 's'}</span>
      </div>
      <p className="text-foreground leading-relaxed">
        Across <span className="num font-semibold">{insights.sessions}</span> sessions:{' '}
        {sacrifices.length ? sacrifices.join(', ') : 'no sacrifices recorded'} ·{' '}
        <span className="num font-semibold">{totalRefusals}</span> refusal{totalRefusals === 1 ? '' : 's'}
        {insights.avg_rounds_to_approval !== null ? ` · ${insights.avg_rounds_to_approval} rounds to approval on average` : ''}
        {insights.avg_event_resolution_seconds !== null ? ` · events resolved in ${insights.avg_event_resolution_seconds} s on average` : ''}.
      </p>
    </section>
  );
}
