'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DEPARTMENT_LABEL, RESOURCE_LABEL } from '@/domain/constants';
import { EVENT_PRESETS, INITIAL_POOL } from '@/domain/scenario';
import { AGENT_IDS, DEPARTMENT_IDS, RESOURCE_KEYS, type CouncilMessage, type PublicState, type ResourceVector } from '@/domain/types';
import type { StreamEvent } from '@/domain/stream';

type Toast = { id: number; level: string; text: string };
type Forecast = {
  interpretation: { title: string; source: string; warnings: string[] };
  forecast: { effects: string[]; feasibleBase: number; feasibleOverride: number; previousPlanWouldBe: string | null; certificate: { requests: string[] } | null };
};

const STATUS_TONE: Record<string, string> = {
  PASS: 'text-emerald-600 dark:text-emerald-400',
  FAIL: 'text-red-600 dark:text-red-400',
  SKIP: 'text-zinc-400',
  PENDING: 'text-amber-600 dark:text-amber-400',
  NA: 'text-zinc-400',
};

const parse = <T extends StreamEvent['type']>(e: Event) => JSON.parse((e as MessageEvent<string>).data) as Extract<StreamEvent, { type: T }>;

function mergeMessages(prev: CouncilMessage[], incoming: CouncilMessage[]): CouncilMessage[] {
  if (incoming.length === 0) return prev;
  const last = prev[prev.length - 1]?.seq ?? 0;
  if (incoming.every((m) => m.seq > last)) return [...prev, ...incoming];
  const bySeq = new Map(prev.map((m) => [m.seq, m]));
  for (const m of incoming) bySeq.set(m.seq, m);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

export function DevConsole() {
  const [state, setState] = useState<PublicState | null>(null);
  const [messages, setMessages] = useState<CouncilMessage[]>([]);
  const [conn, setConn] = useState<'connecting' | 'live' | 'reconnecting'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pool, setPool] = useState<ResourceVector>({ ...INITIAL_POOL });
  const [maxRounds, setMaxRounds] = useState('');
  const [judgeCode, setJudgeCode] = useState('');
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [eventText, setEventText] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const syncing = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (sinceSeq = 0) => {
    const res = await fetch(`/api/state${sinceSeq ? `?sinceSeq=${sinceSeq}` : ''}`, { cache: 'no-store' });
    const body = (await res.json()) as { state?: PublicState; messages?: CouncilMessage[]; error?: string };
    if (!res.ok || !body.state) throw new Error(body.error ?? `HTTP ${res.status}`);
    setState(body.state);
    setMessages((prev) => (sinceSeq ? mergeMessages(prev, body.messages ?? []) : (body.messages ?? [])));
  }, []);

  useEffect(() => {
    const es = new EventSource('/api/stream');
    // Every (re)connect resyncs the full state; replayed stream events merge by seq.
    es.onopen = () => {
      setConn('live');
      load().catch((e: unknown) => setError(String(e)));
    };
    es.onerror = () => setConn('reconnecting');
    es.addEventListener('state.updated', (e) => setState(parse<'state.updated'>(e).state));
    es.addEventListener('message.created', (e) => {
      const { message } = parse<'message.created'>(e);
      setMessages((prev) => mergeMessages(prev, [message]));
    });
    es.addEventListener('agent.status', (e) => {
      const evt = parse<'agent.status'>(e);
      setState((prev) => (prev ? { ...prev, agents: { ...prev.agents, [evt.agentId]: { ...prev.agents[evt.agentId], status: evt.status } } } : prev));
    });
    es.addEventListener('toast', (e) => {
      const evt = parse<'toast'>(e);
      setToasts((prev) => [...prev.slice(-4), { id: Date.now() + Math.random(), level: evt.level, text: evt.text }]);
    });
    es.addEventListener('session.reset', () => {
      setMessages([]);
      setForecast(null);
      load().catch((err: unknown) => setError(String(err)));
    });
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      es.close();
      clearInterval(tick);
    };
  }, [load]);

  // A reconnect older than the server's ring buffer only sends state.updated: fetch whatever the list is missing.
  const messageCount = state?.messageCount ?? 0;
  const lastSeq = messages[messages.length - 1]?.seq ?? 0;
  useEffect(() => {
    if (messageCount <= messages.length || syncing.current) return;
    const timer = setTimeout(() => {
      syncing.current = true;
      load(lastSeq)
        .catch((e: unknown) => setError(String(e)))
        .finally(() => (syncing.current = false));
    }, 400);
    return () => clearTimeout(timer);
  }, [messageCount, messages.length, lastSeq, load]);

  useEffect(() => {
    const el = listRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const call = async <T,>(label: string, path: string, body: unknown = {}): Promise<T | null> => {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(judgeCode ? { 'x-judge-code': judgeCode } : {}) },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as T & { error?: string };
      if (!res.ok) throw new Error(res.status === 401 ? `${data.error ?? 'Unauthorized'} Enter the access code above.` : (data.error ?? `HTTP ${res.status}`));
      return data;
    } catch (e) {
      setError(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const inject = async (request: Record<string, unknown>) => {
    const preview = await call<Forecast>('Interpret event', '/api/events/interpret', request);
    if (!preview) return;
    setForecast(preview);
    await call('Apply event', '/api/events/apply', { interpretation: preview.interpretation });
  };

  const start = () =>
    call('Start', '/api/control/start', { resources: pool, ...(maxRounds.trim() ? { maxRounds: Number(maxRounds) } : {}) });

  const hardReset = () => {
    if (window.confirm('Delete every stored session of this instance (database and local files)?')) void call('Hard reset', '/api/control/reset', { hard: true, confirm: 'DELETE' });
  };

  const run = state?.run;
  const scenario = state?.scenarios.find((s) => s.id === run?.scenarioId) ?? state?.scenarios[state.scenarios.length - 1];
  const plan = state?.plans[state.plans.length - 1];
  const report = plan?.validations[plan.validations.length - 1];
  const deadline = run?.deadlineAt ? Math.max(0, Math.round((Date.parse(run.deadlineAt) - now) / 1000)) : null;
  const fallbackCount = messages.filter((m) => m.source === 'FALLBACK').length;
  const llmCount = messages.filter((m) => m.source === 'LLM').length;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 text-sm">
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <h1 className="text-lg font-semibold">ARES ACCORD · debug console</h1>
        <Badge>{state ? `agents: ${state.config.mode}` : 'loading…'}</Badge>
        <Badge tone={conn === 'live' ? 'ok' : 'warn'}>stream: {conn}</Badge>
        {state && (
          <Badge tone={state.storage.state === 'SYNCED' || state.storage.driver === 'file' ? 'ok' : state.storage.state === 'ERROR' ? 'bad' : 'warn'}>
            storage: {state.storage.driver} · {state.storage.state.toLowerCase()} · pending {state.storage.pendingRows}
            {state.storage.dbMessageCount !== null ? ` · ${state.storage.dbMessageCount} msgs in DB` : ''}
          </Badge>
        )}
        <Badge>
          LLM {llmCount} · FALLBACK {fallbackCount}
        </Badge>
        <a className="ml-auto text-xs underline" href="/api/health?deep=1" target="_blank" rel="noreferrer">
          health
        </a>
      </header>

      {state?.storage.lastError && <p className="rounded bg-red-50 p-2 text-red-700 dark:bg-red-950 dark:text-red-300">Storage: {state.storage.lastError.hint}</p>}
      {state?.storage.leaseWarning && <p className="rounded bg-amber-50 p-2 text-amber-800 dark:bg-amber-950 dark:text-amber-300">{state.storage.leaseWarning}</p>}
      {error && <p className="rounded bg-red-50 p-2 text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}

      <section className="font-mono text-xs">
        {run ? (
          <>
            run <b>{run.status}</b> · phase <b>{run.phase}</b> · scenario <b>{scenario?.id ?? '—'}</b>
            {scenario ? ` (${scenario.kind}${scenario.policy.crisisOverride ? ', CRISIS OVERRIDE' : ''})` : ''} · round <b>{run.round}</b>/{scenario?.maxRounds ?? '—'} · plan{' '}
            <b>{plan ? `v${plan.version} ${plan.status}` : '—'}</b> · in force <b>{state.planInForceVersion ? `v${state.planInForceVersion}` : '—'}</b>
            {deadline !== null && run.status === 'RUNNING' ? ` · deadline ${deadline}s` : ''}
            {run.activeAgents.length ? ` · thinking: ${run.activeAgents.join(', ')}` : ''}
            {run.lastError ? ` · last error: ${run.lastError}` : ''}
          </>
        ) : (
          'connecting…'
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Panel title="Council controls">
          <div className="flex flex-wrap items-end gap-2">
            {RESOURCE_KEYS.map((k) => (
              <label key={k} className="flex flex-col text-xs">
                {RESOURCE_LABEL[k].name}
                <input
                  className="w-20 rounded border border-zinc-300 bg-transparent px-1 py-0.5 dark:border-zinc-700"
                  type="number"
                  min={0}
                  max={999}
                  value={pool[k]}
                  onChange={(e) => setPool({ ...pool, [k]: Number(e.target.value) })}
                />
              </label>
            ))}
            <label className="flex flex-col text-xs">
              max rounds
              <input className="w-16 rounded border border-zinc-300 bg-transparent px-1 py-0.5 dark:border-zinc-700" placeholder="6" value={maxRounds} onChange={(e) => setMaxRounds(e.target.value)} />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={start} disabled={!!busy}>
              Start
            </Button>
            <Button onClick={() => call('Resume', '/api/control/resume')} disabled={!!busy}>
              Resume
            </Button>
            <Button onClick={() => call('Reset', '/api/control/reset')} disabled={!!busy}>
              Reset (archive)
            </Button>
            <Button onClick={hardReset} disabled={!!busy} danger>
              Hard reset
            </Button>
            {scenario?.status === 'AWAITING_COUNTERSIGN' && (
              <>
                <Button onClick={() => call('Countersign', '/api/control/countersign', { decision: 'COUNTERSIGN' })}>Countersign</Button>
                <Button onClick={() => call('Veto', '/api/control/countersign', { decision: 'VETO', reason: window.prompt('Veto reason') ?? '' })} danger>
                  Veto
                </Button>
              </>
            )}
          </div>
          <label className="mt-3 flex items-center gap-2 text-xs">
            access code
            <input
              className="w-40 rounded border border-zinc-300 bg-transparent px-1 py-0.5 dark:border-zinc-700"
              type="password"
              value={judgeCode}
              onChange={(e) => setJudgeCode(e.target.value)}
              placeholder="only if JUDGE_ACCESS_CODE is set"
            />
          </label>
          {busy && <p className="mt-2 text-xs text-zinc-500">{busy}…</p>}
        </Panel>

        <Panel title="Inject an event">
          <div className="flex flex-wrap gap-2">
            {EVENT_PRESETS.map((p) => (
              <Button key={p.id} onClick={() => inject({ kind: 'preset', presetId: p.id })} disabled={!!busy || !state?.scenarios.length} title={p.description}>
                {p.name}
              </Button>
            ))}
          </div>
          <textarea
            className="mt-3 h-20 w-full rounded border border-zinc-300 bg-transparent p-1 font-mono text-xs dark:border-zinc-700"
            placeholder='Event JSON (event_injection_format.json) or a sentence, e.g. "Dust storm: power -25%"'
            value={eventText}
            onChange={(e) => setEventText(e.target.value)}
          />
          <div className="mt-1 flex gap-2">
            <Button onClick={() => inject({ kind: 'json', input: eventText })} disabled={!!busy || !eventText.trim()}>
              Apply JSON
            </Button>
            <Button onClick={() => inject({ kind: 'text', input: eventText })} disabled={!!busy || !eventText.trim()}>
              Apply text
            </Button>
          </div>
          {forecast && (
            <div className="mt-3 rounded bg-zinc-50 p-2 font-mono text-xs dark:bg-zinc-900">
              <b>{forecast.interpretation.title}</b> ({forecast.interpretation.source}) · {forecast.forecast.effects.join('; ') || 'no effects'}
              <br />
              feasible plans: {forecast.forecast.feasibleBase} under base policy · {forecast.forecast.feasibleOverride} under Crisis Override · plan in force would be{' '}
              {forecast.forecast.previousPlanWouldBe ?? '—'}
              {forecast.forecast.certificate && <span className="text-red-600"> · INFEASIBLE: {forecast.forecast.certificate.requests.join(' ')}</span>}
              {forecast.interpretation.warnings.length > 0 && <span className="text-amber-600"> · {forecast.interpretation.warnings.join(' ')}</span>}
            </div>
          )}
        </Panel>
      </section>

      {state && (
        <section className="grid gap-4 lg:grid-cols-3">
          <Panel title="Agents">
            <ul className="space-y-1 font-mono text-xs">
              {AGENT_IDS.map((id) => {
                const a = state.agents[id];
                return (
                  <li key={id}>
                    <b>{id}</b> {a.status}
                    {a.requestedMode ? ` · wants ${a.requestedMode}` : ''}
                    {a.stance ? ` · sacrifice ${a.stance.sacrifice}` : ''} · llm {a.stats.llmCalls} / fb {a.stats.fallbacks}
                    {a.stats.llmCalls ? ` · ${Math.round(a.stats.totalLatencyMs / Math.max(1, a.stats.llmCalls + a.stats.fallbacks))} ms avg` : ''}
                  </li>
                );
              })}
            </ul>
            <h3 className="mt-3 text-xs font-semibold">Scenarios</h3>
            <ul className="space-y-1 font-mono text-xs">
              {state.scenarios.map((s) => (
                <li key={s.id}>
                  {s.id} {s.kind} “{s.title}” · {s.outcome ?? s.status} · R{s.round}
                  {s.approvedPlanVersion ? ` · v${s.approvedPlanVersion}` : ''}
                  {s.outcomeReason ? ` · ${s.outcomeReason}` : ''}
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title={plan ? `Plan v${plan.version} · ${plan.status}` : 'Plan'}>
            {plan ? (
              <div className="font-mono text-xs">
                {DEPARTMENT_IDS.map((d) => `${DEPARTMENT_LABEL[d]} ${plan.selections[d]}`).join(' · ')}
                <br />
                totals {RESOURCE_KEYS.map((k) => `${RESOURCE_LABEL[k].short}${plan.totals[k]}/${plan.poolSnapshot[k]}`).join(' ')} · risk {plan.risk} · sacrifices{' '}
                {plan.sacrifices.join(', ') || 'none'} · votes {plan.votes.filter((v) => v.planVersion === plan.version && v.decision === 'ACCEPT').length} ACCEPT
                {report && (
                  <ul className="mt-2 space-y-0.5">
                    <li className="font-semibold">
                      validation {report.stage}: <span className={STATUS_TONE[report.status]}>{report.status}</span>
                    </li>
                    {report.checks.map((c) => (
                      <li key={c.id}>
                        <span className={STATUS_TONE[c.status]}>{c.status.padEnd(4)}</span> {c.id} · {c.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="text-xs text-zinc-500">No plan drafted yet.</p>
            )}
          </Panel>

          <Panel title={`Compliance ${state.compliance.passed}/${state.compliance.applicable}`}>
            <ul className="space-y-0.5 font-mono text-xs">
              {state.compliance.items.map((i) => (
                <li key={i.id} title={i.detail}>
                  <span className={STATUS_TONE[i.status]}>{i.status.padEnd(7)}</span> {i.label}
                </li>
              ))}
            </ul>
          </Panel>
        </section>
      )}

      <Panel title={`Transcript (${messages.length})`}>
        <div ref={listRef} className="max-h-[32rem] overflow-y-auto font-mono text-xs">
          {messages.map((m) => (
            <details key={m.seq} className="border-b border-zinc-100 py-0.5 dark:border-zinc-900">
              <summary className="cursor-pointer">
                [{m.seq}] {m.scenarioId} R{m.round} {m.type}
                {m.subtype ? `/${m.subtype}` : ''} {m.from}→{m.to === 'ALL' ? 'ALL' : m.to.join(',')}: {m.summary}{' '}
                {m.source === 'FALLBACK' && <span className="rounded bg-amber-200 px-1 text-amber-900">FALLBACK</span>}
                {m.source === 'LLM' && m.meta && <span className="text-zinc-400">({m.meta.model} · {m.meta.latencyMs} ms)</span>}
              </summary>
              <p className="whitespace-pre-wrap py-1 pl-4 text-zinc-600 dark:text-zinc-400">{m.body}</p>
              {m.meta?.fallbackReason && <p className="pl-4 text-amber-700">fallback reason: {m.meta.fallbackReason}</p>}
              {m.meta?.toolCalls.length ? <p className="pl-4 text-zinc-500">tools: {m.meta.toolCalls.map((t) => t.name).join(', ')}</p> : null}
            </details>
          ))}
        </div>
      </Panel>

      <footer className="flex flex-wrap gap-3 text-xs">
        <span className="font-semibold">Export:</span>
        <a className="underline" href="/api/export?format=json">session JSON</a>
        {(['transcript', 'plans', 'votes', 'commitments'] as const).map((k) => (
          <a key={k} className="underline" href={`/api/export?format=csv&kind=${k}`}>
            {k}.csv
          </a>
        ))}
        <a className="underline" href="/api/export?format=final">final_allocation.json</a>
        <a className="underline" href="/api/sessions" target="_blank" rel="noreferrer">
          archive
        </a>
      </footer>

      <div className="fixed bottom-3 right-3 flex w-80 flex-col gap-1">
        {toasts.map((t) => (
          <div key={t.id} className={`rounded px-2 py-1 text-xs shadow ${t.level === 'error' ? 'bg-red-600 text-white' : t.level === 'warning' ? 'bg-amber-500 text-black' : t.level === 'success' ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-white'}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      {children}
    </section>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: 'ok' | 'warn' | 'bad' }) {
  const color =
    tone === 'ok'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
      : tone === 'warn'
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
        : tone === 'bad'
          ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
          : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300';
  return <span className={`rounded px-2 py-0.5 text-xs ${color}`}>{children}</span>;
}

function Button({ children, onClick, disabled, danger, title }: { children: React.ReactNode; onClick: () => unknown; disabled?: boolean; danger?: boolean; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={() => void onClick()}
      disabled={disabled}
      className={`rounded border px-2 py-1 text-xs disabled:opacity-40 ${danger ? 'border-red-400 text-red-700 dark:text-red-400' : 'border-zinc-300 dark:border-zinc-700'} hover:bg-zinc-100 dark:hover:bg-zinc-900`}
    >
      {children}
    </button>
  );
}
