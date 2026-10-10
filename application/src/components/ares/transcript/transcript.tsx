'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, Filter, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AGENT_IDS, MESSAGE_TYPES, type CouncilMessage, type MessageSource, type Scenario } from '@/domain/types';
import { EMPTY_FILTERS, useAres, useAresApi, type Filters } from '@/client/store';
import { ACTOR_META, MESSAGE_TYPE_META, SOURCE_TONE, TONE_CLASS } from '@/client/theme';
import { clock, mmss } from '@/client/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AgentEmblem, PanelTitle, ThinkingDots } from '../bits';
import { TurnGroup } from './message-card';
import { OutcomeBanners } from './outcome-banners';

type Item =
  | { kind: 'scenario'; key: string; sc: Scenario | null; scenarioId: string }
  | { kind: 'round'; key: string; round: number; planVersion: number | null }
  | { kind: 'group'; key: string; messages: CouncilMessage[] };

const SOURCES: MessageSource[] = ['LLM', 'FALLBACK', 'DETERMINISTIC', 'HUMAN'];

export function filterMessages(messages: CouncilMessage[], f: Filters): CouncilMessage[] {
  const q = f.q.trim().toLowerCase();
  return messages.filter(
    (m) =>
      (f.scenarioId === 'ALL' || m.scenarioId === f.scenarioId) &&
      (f.agents.length === 0 || f.agents.includes(m.from)) &&
      (f.types.length === 0 || f.types.includes(m.type)) &&
      (f.sources.length === 0 || f.sources.includes(m.source)) &&
      (!q || `${m.id} ${m.from} ${m.type} ${m.subtype ?? ''} ${m.summary} ${m.body}`.toLowerCase().includes(q)),
  );
}

function buildItems(messages: CouncilMessage[], scenarios: Scenario[]): Item[] {
  const items: Item[] = [];
  let scenarioId: string | null = null;
  let round: number | null = null;
  let group: CouncilMessage[] = [];
  const flush = () => {
    if (group.length) items.push({ kind: 'group', key: `g-${group[0]!.seq}`, messages: group });
    group = [];
  };
  for (const m of messages) {
    if (m.scenarioId !== scenarioId) {
      flush();
      scenarioId = m.scenarioId;
      round = null;
      items.push({ kind: 'scenario', key: `s-${m.scenarioId}-${m.seq}`, sc: scenarios.find((s) => s.id === m.scenarioId) ?? null, scenarioId: m.scenarioId });
    }
    if (m.round !== round) {
      flush();
      round = m.round;
      const inRound = messages.filter((x) => x.scenarioId === m.scenarioId && x.round === m.round && x.planVersion);
      items.push({ kind: 'round', key: `r-${m.scenarioId}-${m.round}-${m.seq}`, round: m.round, planVersion: inRound.length ? Math.max(...inRound.map((x) => x.planVersion!)) : null });
    }
    const prev = group[group.length - 1];
    const sameTurn = prev && m.turnId && prev.turnId === m.turnId && prev.from === m.from;
    if (!sameTurn) flush();
    group.push(m);
  }
  flush();
  return items;
}

export function Transcript() {
  const state = useAres((s) => s.state);
  const messages = useAres((s) => s.messages);
  const filters = useAres((s) => s.ui.filters);
  const autoScroll = useAres((s) => s.ui.autoScroll);
  const highlightId = useAres((s) => s.ui.highlightMessageId);
  const highlightNonce = useAres((s) => s.ui.highlightNonce);
  const setUi = useAres((s) => s.setUi);
  const setFilters = useAres((s) => s.setFilters);
  const api = useAresApi();
  const listRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const lastUserInput = useRef(0);
  const [mountedAt] = useState(() => Date.now());
  const [unseenFrom, setUnseenFrom] = useState<number | null>(null);

  const filtered = useMemo(() => filterMessages(messages, filters), [messages, filters]);
  const scenarios = state?.scenarios;
  const items = useMemo(() => buildItems(filtered, scenarios ?? []), [filtered, scenarios]);
  const unseen = unseenFrom === null ? 0 : Math.max(0, filtered.length - unseenFrom);

  // Follow live output: re-pin whenever the content grows (new messages, lazily rendered groups, thinking bubbles).
  useEffect(() => {
    const el = listRef.current;
    const inner = innerRef.current;
    if (!el || !inner) return;
    const pin = () => {
      if (api.getState().ui.autoScroll) el.scrollTop = el.scrollHeight;
    };
    const ro = new ResizeObserver(pin);
    ro.observe(inner);
    pin();
    return () => ro.disconnect();
  }, [api]);
  useEffect(() => {
    const el = listRef.current;
    if (el && autoScroll) el.scrollTop = el.scrollHeight;
  }, [autoScroll, filtered.length]);

  // Evidence chips, "responds to" links, and #M-0042 anchors scroll to and flash a message.
  useEffect(() => {
    if (!highlightId) return;
    const el = document.getElementById(`msg-${highlightId}`);
    if (!el) {
      if (filters !== EMPTY_FILTERS && messages.some((m) => m.id === highlightId)) setFilters(EMPTY_FILTERS);
      return;
    }
    setUi({ autoScroll: false });
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }, [highlightId, highlightNonce, filters, messages, setFilters, setUi]);

  const markUserInput = () => {
    lastUserInput.current = Date.now();
  };

  // Only the reader's own scrolling (wheel, touch, keys, scrollbar) can stop "follow live".
  const onScroll = () => {
    const el = listRef.current;
    if (!el || Date.now() - lastUserInput.current > 1000) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom !== autoScroll) setUi({ autoScroll: atBottom });
    setUnseenFrom(atBottom ? null : (unseenFrom ?? filtered.length));
  };

  const jumpToEnd = () => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setUi({ autoScroll: true });
    setUnseenFrom(null);
  };

  const lastFresh = (group: CouncilMessage[]) => Date.parse(group[group.length - 1]!.createdAt) > mountedAt - 1500;

  return (
    <section aria-labelledby="council-transcript" className="flex h-full min-h-0 flex-col gap-2">
      <PanelTitle right={<span className="num text-[11px] text-muted-foreground">Showing {filtered.length} of {messages.length}</span>}>
        <span id="council-transcript">Council Transcript</span>
      </PanelTitle>
      <FilterBar />
      <OutcomeBanners />
      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          onScroll={onScroll}
          onWheel={markUserInput}
          onTouchMove={markUserInput}
          onPointerDown={markUserInput}
          onKeyDown={markUserInput}
          className="scrollbar-thin absolute inset-0 overflow-y-auto pr-1"
          aria-live="off"
        >
          <div ref={innerRef} className="flex flex-col gap-2 pb-16">
            {messages.length === 0 && <TranscriptEmpty />}
            {items.map((item) =>
              item.kind === 'scenario' ? (
                <ScenarioDivider key={item.key} sc={item.sc} scenarioId={item.scenarioId} />
              ) : item.kind === 'round' ? (
                <RoundDivider key={item.key} round={item.round} planVersion={item.planVersion} />
              ) : (
                <TurnGroup key={item.key} messages={item.messages} fresh={lastFresh(item.messages)} />
              ),
            )}
            <ThinkingBubbles />
          </div>
        </div>
        {unseen > 0 && !autoScroll && (
          <button type="button" onClick={jumpToEnd} className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full border border-mars/50 bg-panel px-3 py-1 text-xs shadow-lg">
            <ArrowDown className="size-3.5" /> {unseen} new message{unseen === 1 ? '' : 's'}
          </button>
        )}
      </div>
    </section>
  );
}

function TranscriptEmpty() {
  return <p className="px-2 py-8 text-center text-sm text-muted-foreground">No messages yet — the Commander opens the council with a briefing as soon as you start the crisis.</p>;
}

function ScenarioDivider({ sc, scenarioId }: { sc: Scenario | null; scenarioId: string }) {
  const took = sc?.startedAt && sc.resolvedAt ? mmss(Date.parse(sc.resolvedAt) - Date.parse(sc.startedAt)) : null;
  return (
    <div className="flex items-center gap-2 pt-2 text-xs font-semibold tracking-wide text-muted-foreground" role="separator">
      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-mars/50" />
      <span className="num text-foreground">{scenarioId}</span>
      <span>· {sc?.kind === 'BASELINE' ? 'Baseline' : (sc?.title ?? '')}</span>
      {sc?.startedAt && <span className="meta-secondary num font-normal">· started {clock(sc.startedAt)}</span>}
      {sc?.outcome && (
        <span className={cn('font-normal', sc.outcome === 'APPROVED' ? 'text-success' : sc.outcome === 'INFEASIBLE' ? 'text-danger' : 'text-amber')}>
          · {sc.outcome}
          {sc.approvedPlanVersion ? ` v${sc.approvedPlanVersion}` : ''} in R{sc.round}
          {took ? ` (${took})` : ''}
        </span>
      )}
      <span className="h-px flex-1 bg-gradient-to-l from-transparent to-mars/50" />
    </div>
  );
}

function RoundDivider({ round, planVersion }: { round: number; planVersion: number | null }) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground" role="separator">
      <span className="h-px w-4 bg-border" />
      <span>{round === 0 ? 'Event intake' : `Round ${round}`}</span>
      {planVersion ? <span className="num text-mars/80">· plan v{planVersion}</span> : null}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

const PHASE_ACTIVITY: Record<string, string> = {
  BRIEFING: 'is briefing the council',
  POSITIONS: 'is stating a position',
  SYNTHESIS: 'is drafting the plan',
  CONSENT: 'is deciding on consent',
  VOTING: 'is voting',
  DECISION: 'is deciding',
};

function ThinkingBubbles() {
  const run = useAres((s) => s.state?.run);
  if (!run || run.activeAgents.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 px-1" aria-hidden>
      {run.activeAgents.map((id) => (
        <div key={id} className="flex items-center gap-2 text-xs text-muted-foreground">
          <AgentEmblem id={id} size={18} />
          <span className="font-semibold" style={{ color: ACTOR_META[id].color }}>
            {ACTOR_META[id].callsign}
          </span>
          <span>{PHASE_ACTIVITY[run.phase] ?? 'is thinking'}</span>
          <ThinkingDots color={ACTOR_META[id].color} />
        </div>
      ))}
    </div>
  );
}

function FilterBar() {
  const state = useAres((s) => s.state);
  const filters = useAres((s) => s.ui.filters);
  const setFilters = useAres((s) => s.setFilters);
  const active = filters.scenarioId !== 'ALL' || filters.agents.length > 0 || filters.types.length > 0 || filters.sources.length > 0 || filters.q;
  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        aria-label="Scenario filter"
        value={filters.scenarioId}
        onChange={(e) => setFilters({ scenarioId: e.target.value })}
        className="h-7 rounded-md border border-border bg-panel-2 px-2 text-xs"
      >
        <option value="ALL">All scenarios</option>
        {state?.scenarios.map((sc) => (
          <option key={sc.id} value={sc.id}>
            {sc.id} · {sc.kind === 'BASELINE' ? 'Baseline' : sc.title}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-0.5" role="group" aria-label="Agent filter">
        {AGENT_IDS.map((id) => {
          const on = filters.agents.includes(id);
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              title={`${ACTOR_META[id].callsign} only`}
              onClick={() => setFilters({ agents: toggle(filters.agents, id) })}
              className={cn('rounded-full p-0.5', on ? 'ring-2 ring-mars' : 'opacity-60 hover:opacity-100')}
            >
              <AgentEmblem id={id} size={20} />
            </button>
          );
        })}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-7">
            <Filter /> Types{filters.types.length ? ` (${filters.types.length})` : ''}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Message types</DropdownMenuLabel>
          {MESSAGE_TYPES.map((t) => (
            <DropdownMenuCheckboxItem key={t} checked={filters.types.includes(t)} onCheckedChange={() => setFilters({ types: toggle(filters.types, t) })} onSelect={(e) => e.preventDefault()}>
              {MESSAGE_TYPE_META[t].label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="flex items-center gap-0.5" role="group" aria-label="Source filter">
        {SOURCES.map((src) => {
          const on = filters.sources.includes(src);
          return (
            <button
              key={src}
              type="button"
              aria-pressed={on}
              onClick={() => setFilters({ sources: toggle(filters.sources, src) })}
              className={cn('rounded-[6px] border px-1.5 py-0.5 text-[10px] font-medium', on ? TONE_CLASS[SOURCE_TONE[src]] : 'border-border text-muted-foreground')}
            >
              {src}
            </button>
          );
        })}
      </div>
      <div className="relative ml-auto">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input id="transcript-search" value={filters.q} onChange={(e) => setFilters({ q: e.target.value })} placeholder="Search  ( / )" className="h-7 w-44 pl-7 text-xs" aria-label="Search the transcript" />
      </div>
      {active && (
        <Button variant="ghost" size="sm" className="h-7" onClick={() => setFilters(EMPTY_FILTERS)}>
          <X /> Clear
        </Button>
      )}
    </div>
  );
}
