'use client';

import { useMemo } from 'react';
import { ExternalLink, Lock } from 'lucide-react';
import { PROFILES } from '@/domain/scenario';
import { AGENT_IDS, type AgentId, type CouncilMessage, type PublicState, type Vote } from '@/domain/types';
import { useAres } from '@/client/store';
import { ACTOR_META } from '@/client/theme';
import { clock } from '@/client/format';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AgentEmblem, Pill, StanceBadge, TierPill } from './bits';
import { MessageMeta } from './transcript/message-card';
import { CommitmentLine } from './transcript/bodies';

export function AgentMindSheet() {
  const selected = useAres((s) => s.ui.selectedAgent);
  const state = useAres((s) => s.state);
  const messages = useAres((s) => s.messages);
  const setUi = useAres((s) => s.setUi);
  const open = selected !== null && state !== null;
  return (
    <Sheet open={open} onOpenChange={(o) => !o && setUi({ selectedAgent: null })}>
      <SheetContent side="right" className="gap-0 overflow-y-auto border-l bg-panel p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[640px]">
        {open && <Mind id={selected} state={state} messages={messages} />}
      </SheetContent>
    </Sheet>
  );
}

function Mind({ id, state, messages }: { id: AgentId; state: PublicState; messages: CouncilMessage[] }) {
  const p = PROFILES[id];
  const meta = ACTOR_META[id];
  const agent = state.agents[id];
  const isDept = id !== 'COMMANDER';
  const votes = useMemo(() => state.plans.flatMap((pl) => pl.votes.filter((v) => v.agentId === id)), [state.plans, id]);
  const own = useMemo(() => messages.filter((m) => m.from === id), [messages, id]);
  const inbox = useMemo(() => messages.filter((m) => m.from !== id && m.to !== 'ALL' && m.to.includes(id)), [messages, id]);
  const traceId = [...own].reverse().find((m) => m.meta?.traceId)?.meta?.traceId;
  const lastModel = [...own].reverse().find((m) => m.meta?.model)?.meta?.model;
  const calls = agent.stats.llmCalls + agent.stats.fallbacks;
  return (
    <>
      <SheetHeader className="border-b p-4" style={{ background: `linear-gradient(90deg, ${meta.color}1f, transparent)` }}>
        <SheetTitle className="flex items-center gap-3">
          <AgentEmblem id={id} size={40} />
          <span className="flex flex-col">
            <span className="text-lg tracking-wide" style={{ color: meta.color }}>
              {p.callsign}
            </span>
            <span className="text-sm font-normal text-muted-foreground">
              {p.name} · {p.title}
            </span>
          </span>
        </SheetTitle>
        <SheetDescription>
          {p.mission}. Main concern: {p.mainConcern}.
        </SheetDescription>
      </SheetHeader>
      <Tabs defaultValue="profile" className="p-4">
        <TabsList className="w-full">
          <TabsTrigger value="profile">Profile & state</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="memory">Memory & runtime</TabsTrigger>
          <TabsTrigger value="messages">Messages</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="flex flex-col gap-3 pt-3">
          <List title="Goals" items={p.goals} />
          <List title="Constraints" items={p.constraints} />
          <List title="Red lines" items={p.redLines} tone="text-danger" />
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Voice:</span> {p.voice}
          </p>
          <section className="flex flex-col gap-1.5 rounded-lg border bg-panel-2 p-2.5">
            <h3 className="panel-title">Live state</h3>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span>Status: {agent.status}</span>
              {isDept && (
                <>
                  <span className="text-muted-foreground">· requests</span> <TierPill modeId={agent.requestedMode} withRisk />
                  <StanceBadge stance={agent.stance?.sacrifice} conditions={agent.stance?.conditions} />
                </>
              )}
            </div>
            {agent.stance?.conditions.length ? <p className="text-xs text-amber">Conditions: {agent.stance.conditions.join('; ')}</p> : null}
            {votes.length > 0 && <LastVote vote={votes[votes.length - 1]!} />}
            {Object.keys(agent.trust).length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Trust toward others</span>
                {AGENT_IDS.filter((o) => o !== id && agent.trust[o] !== undefined).map((o) => (
                  <div key={o} className="grid grid-cols-[80px_1fr_30px] items-center gap-2 text-xs">
                    <span style={{ color: ACTOR_META[o].color }}>{ACTOR_META[o].callsign}</span>
                    <div className="h-1.5 rounded-full bg-panel">
                      <div className="h-1.5 rounded-full" style={{ width: `${Math.max(0, Math.min(100, (agent.trust[o] ?? 0) * 100))}%`, backgroundColor: ACTOR_META[o].color }} />
                    </div>
                    <span className="num text-right">{(agent.trust[o] ?? 0).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </TabsContent>

        <TabsContent value="timeline" className="flex flex-col gap-3 pt-3">
          <Timeline state={state} id={id} votes={votes} />
          <section className="flex flex-col gap-1.5">
            <h3 className="panel-title">Ledger</h3>
            {agent.sacrificeLedger.length === 0 ? (
              <p className="text-xs text-muted-foreground">No sacrifice taken yet.</p>
            ) : (
              agent.sacrificeLedger.map((s, i) => (
                <p key={i} className="num text-xs">
                  {s.scenarioId}: ran <span className="text-danger">{s.modeId}</span> in v{s.planVersion} · returns {s.commitmentIds.join(', ') || 'none'}
                </p>
              ))
            )}
            <span className="text-xs text-muted-foreground">Commitments given</span>
            {state.commitments.filter((c) => c.owner === id).map((c) => <CommitmentLine key={c.id} c={c} />)}
            <span className="text-xs text-muted-foreground">Commitments received</span>
            {state.commitments.filter((c) => c.beneficiary === id).map((c) => <CommitmentLine key={c.id} c={c} />)}
          </section>
        </TabsContent>

        <TabsContent value="memory" className="flex flex-col gap-3 pt-3">
          <section className="flex flex-col gap-1.5">
            <h3 className="panel-title flex items-center gap-1.5">
              <Lock className="size-3" /> Private memory
            </h3>
            <p className="text-[11px] text-muted-foreground">🔒 Private to this agent — never shown to the other agents.</p>
            {agent.memory.length === 0 && <p className="text-xs text-muted-foreground">No private notes yet.</p>}
            {[...agent.memory].reverse().map((n, i) => (
              <p key={i} className="rounded-md border bg-panel-2 px-2 py-1 text-xs">
                <span className="num text-muted-foreground">
                  {n.scenarioId} R{n.round} · {clock(n.at)}
                </span>{' '}
                {n.note}
              </p>
            ))}
          </section>
          <section className="flex flex-col gap-1 rounded-lg border bg-panel-2 p-2.5 text-xs">
            <h3 className="panel-title">Runtime (OpenAI Agents SDK)</h3>
            <span className="num">
              Session <span className="text-muted-foreground">{state.id.slice(0, 8)}…:{id}</span> · {agent.sessionItemCount} private history items
            </span>
            <span className="num">
              LLM calls {agent.stats.llmCalls} · fallbacks <span className={agent.stats.fallbacks ? 'text-amber' : undefined}>{agent.stats.fallbacks}</span> · avg{' '}
              {calls ? `${(agent.stats.totalLatencyMs / calls / 1000).toFixed(1)}s` : '—'}
            </span>
            <span className="num">
              Tokens in {agent.stats.inputTokens.toLocaleString()} · out {agent.stats.outputTokens.toLocaleString()} · model {lastModel ?? (id === 'COMMANDER' ? state.config.models.commander : state.config.models.departments)}
            </span>
            {traceId && (
              <a className="inline-flex items-center gap-1 text-info hover:underline" href={`https://platform.openai.com/traces/trace?trace_id=${encodeURIComponent(traceId)}`} target="_blank" rel="noreferrer">
                Latest trace {traceId.slice(0, 18)}… <ExternalLink className="size-3" />
              </a>
            )}
          </section>
          <section className="rounded-lg border bg-panel-2 p-2.5 text-xs">
            <h3 className="panel-title">Persistence</h3>
            {state.storage.driver === 'supabase' ? (
              <p>
                Private history persisted in Supabase — <span className="num">ares_agent_memory</span>: {agent.sessionItemCount} items · state in <span className="num">ares_agent_states</span> (one row per agent).
              </p>
            ) : (
              <p>Private history and state persisted in the local snapshot ({agent.sessionItemCount} items).</p>
            )}
          </section>
        </TabsContent>

        <TabsContent value="messages" className="flex flex-col gap-3 pt-3">
          <MessageList title={`Own messages (${own.length})`} messages={own} />
          <MessageList title={`Addressed directly to ${p.callsign} (${inbox.length})`} messages={inbox} />
          <p className="text-[11px] text-muted-foreground">Broadcasts (→ ALL) also reach this agent through its inbox packet each turn.</p>
        </TabsContent>
      </Tabs>
    </>
  );
}

function List({ title, items, tone }: { title: string; items: string[]; tone?: string }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="panel-title">{title}</h3>
      <ul className={`list-inside list-disc text-[13px] ${tone ?? ''}`}>
        {items.map((g, i) => (
          <li key={i}>{g}</li>
        ))}
      </ul>
    </section>
  );
}

function LastVote({ vote }: { vote: Vote }) {
  return (
    <p className="text-xs">
      Last vote: <Pill tone={vote.decision === 'ACCEPT' ? 'success' : 'danger'}>{vote.decision}</Pill> <span className="num">v{vote.planVersion}</span> — <span className="text-muted-foreground">{vote.reason}</span>
    </p>
  );
}

function Timeline({ state, id, votes }: { state: PublicState; id: AgentId; votes: Vote[] }) {
  const agent = state.agents[id];
  const rows = new Map<string, { scenarioId: string; round: number; mode?: string; stance?: string; vote?: Vote }>();
  const key = (s: string, r: number) => `${s}|${r}`;
  for (const h of agent.requestHistory) rows.set(key(h.scenarioId, h.round), { ...(rows.get(key(h.scenarioId, h.round)) ?? { scenarioId: h.scenarioId, round: h.round }), mode: h.modeId });
  for (const h of agent.stanceHistory) rows.set(key(h.scenarioId, h.round), { ...(rows.get(key(h.scenarioId, h.round)) ?? { scenarioId: h.scenarioId, round: h.round }), stance: h.stance });
  for (const v of votes) {
    const plan = state.plans.find((p) => p.version === v.planVersion);
    if (!plan) continue;
    rows.set(key(plan.scenarioId, v.round), { ...(rows.get(key(plan.scenarioId, v.round)) ?? { scenarioId: plan.scenarioId, round: v.round }), vote: v });
  }
  const list = [...rows.values()];
  if (id === 'COMMANDER' || list.length === 0) return <p className="text-xs text-muted-foreground">{id === 'COMMANDER' ? 'The Commander drafts plans and decides; it does not request a mode or vote.' : 'No turns yet.'}</p>;
  return (
    <table className="num w-full text-xs">
      <thead>
        <tr className="text-muted-foreground">
          <th className="text-left font-normal">Scenario</th>
          <th className="text-left font-normal">Round</th>
          <th className="text-left font-normal">Requested</th>
          <th className="text-left font-normal">Stance</th>
          <th className="text-left font-normal">Vote</th>
        </tr>
      </thead>
      <tbody>
        {list.map((r) => (
          <tr key={`${r.scenarioId}-${r.round}`} className="border-t border-border/60">
            <td>{r.scenarioId}</td>
            <td>R{r.round}</td>
            <td>{r.mode ? <TierPill modeId={r.mode} /> : '—'}</td>
            <td>{r.stance && r.stance !== 'NOT_ASKED' ? r.stance : '—'}</td>
            <td>{r.vote ? `${r.vote.decision} v${r.vote.planVersion}` : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MessageList({ title, messages }: { title: string; messages: CouncilMessage[] }) {
  const highlight = useAres((s) => s.highlight);
  const setUi = useAres((s) => s.setUi);
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="panel-title">{title}</h3>
      {messages.length === 0 && <p className="text-xs text-muted-foreground">None.</p>}
      {[...messages].reverse().slice(0, 40).map((m) => (
        <button
          key={m.seq}
          type="button"
          onClick={() => {
            setUi({ selectedAgent: null });
            highlight(m.id);
          }}
          className="flex flex-col gap-1 rounded-md border bg-panel-2 px-2 py-1.5 text-left hover:border-mars/40"
        >
          <MessageMeta m={m} showActor={false} />
          <span className="line-clamp-2 text-xs text-muted-foreground">{m.summary}</span>
        </button>
      ))}
    </section>
  );
}
