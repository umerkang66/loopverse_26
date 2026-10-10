'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import type { SearchHit, SearchResponse } from '@/domain/api';
import { api } from '@/client/api';
import { useAres } from '@/client/store';
import { ACTOR_META } from '@/client/theme';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Pill } from '../bits';

const SUGGESTIONS = ['refuse sacrifice', 'oxygen reserve', 'crisis override', 'rover'];

/** Splits on «…» and renders matches as <mark> around plain React text nodes. Agent text is never injected as HTML. */
export function Highlighted({ text }: { text: string }) {
  const parts = text.split(/(«[^»]*»)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('«') && p.endsWith('»') ? (
          <mark key={i} className="rounded-sm bg-mars/30 px-0.5 text-foreground">
            {p.slice(1, -1)}
          </mark>
        ) : (
          <Fragment key={i}>{p.replace(/[«»]/g, '')}</Fragment>
        ),
      )}
    </>
  );
}

function actorName(id: string): string {
  return id in ACTOR_META ? ACTOR_META[id as keyof typeof ACTOR_META].callsign : id;
}

/** "Search all negotiations" (Ctrl/Cmd+K): ranked full-text search over every session, grouped by session then scenario. */
export function SearchDialog() {
  const open = useAres((s) => s.ui.dialogs.search);
  const openDialog = useAres((s) => s.openDialog);
  const highlight = useAres((s) => s.highlight);
  const setFilters = useAres((s) => s.setFilters);
  const readOnly = useAres((s) => s.readOnly);
  const router = useRouter();
  const [q, setQ] = useState('');
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (!open || term.length < 2) {
      setResult(null);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    const t = setTimeout(() => {
      api
        .search(term)
        .then((r) => mine === seq.current && setResult(r))
        .catch(() => mine === seq.current && setResult(null))
        .finally(() => mine === seq.current && setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q, open]);

  const groups = useMemo(() => {
    const bySession = new Map<string, { date: string; current: boolean; scenarios: Map<string, SearchHit[]> }>();
    for (const h of result?.hits ?? []) {
      const entry = bySession.get(h.sessionId) ?? { date: h.createdAt, current: h.isCurrentSession, scenarios: new Map() };
      if (h.createdAt < entry.date) entry.date = h.createdAt;
      entry.scenarios.set(h.scenarioId, [...(entry.scenarios.get(h.scenarioId) ?? []), h]);
      bySession.set(h.sessionId, entry);
    }
    return [...bySession.entries()].sort((a, b) => Number(b[1].current) - Number(a[1].current) || b[1].date.localeCompare(a[1].date));
  }, [result]);

  const go = (h: SearchHit) => {
    openDialog('search', false);
    if (h.isCurrentSession && !readOnly) {
      setFilters({ scenarioId: 'ALL' });
      setTimeout(() => highlight(h.messageId), 50);
    } else {
      router.push(`/sessions/${h.sessionId}#${h.messageId}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => openDialog('search', o)}>
      <DialogContent className="top-[12%] translate-y-0 sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="size-4" /> Search all negotiations
          </DialogTitle>
          <DialogDescription>
            Full-text search over every message of every session{result ? ` (${result.source === 'supabase' ? 'Supabase Postgres' : 'local archive'})` : ''}. Quotes match phrases; “-word” excludes.
          </DialogDescription>
        </DialogHeader>
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="refuse sacrifice · oxygen reserve · crisis override" aria-label="Search all negotiations" />
        <div className="scrollbar-thin flex max-h-[55vh] flex-col gap-3 overflow-y-auto" aria-live="polite">
          {q.trim().length < 2 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              Try:
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => setQ(s)} className="rounded-md border px-2 py-1 hover:bg-panel-2">
                  {s}
                </button>
              ))}
            </div>
          )}
          {loading && <p className="text-xs text-muted-foreground">Searching…</p>}
          {!loading && result && result.hits.length === 0 && <p className="text-sm text-muted-foreground">No message matches “{result.query}”.</p>}
          {groups.map(([sessionId, g]) => (
            <section key={sessionId} className="flex flex-col gap-1.5">
              <h4 className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                {new Date(g.date).toLocaleString()} {g.current ? <Pill tone="mars">current session</Pill> : <Pill>archived · {sessionId.slice(0, 8)}</Pill>}
              </h4>
              {[...g.scenarios.entries()].map(([scenarioId, hits]) => (
                <div key={scenarioId} className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{scenarioId}</span>
                  {hits.map((h) => (
                    <button key={`${h.sessionId}:${h.seq}`} type="button" onClick={() => go(h)} className="flex flex-col gap-1 rounded-md border bg-panel-2 px-2.5 py-2 text-left hover:border-mars/50">
                      <span className="text-sm leading-snug">
                        <Highlighted text={h.headline} />
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Pill>{h.type}{h.subtype ? `/${h.subtype}` : ''}</Pill>
                        <Pill tone="info">{actorName(h.from)}</Pill>
                        <Pill>R{h.round}</Pill>
                        {h.planVersion !== null && <Pill tone="stale">v{h.planVersion}</Pill>}
                        <span className="num text-[10px] text-muted-foreground">{h.messageId}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
