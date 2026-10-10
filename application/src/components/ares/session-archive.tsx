'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Archive, Database, HardDrive } from 'lucide-react';
import type { SessionResponse, SessionsResponse } from '@/domain/api';
import { ApiError, api } from '@/client/api';
import { clock } from '@/client/format';
import { OUTCOME_TONE } from '@/client/theme';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Pill } from './bits';
import { ArchivedDashboard } from './dashboard';

export function SessionArchive() {
  const [data, setData] = useState<SessionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .sessions()
      .then((d) => alive && setData(d))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, []);
  return (
    <TooltipProvider>
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
        <header className="flex flex-wrap items-center gap-3">
          <Archive className="size-5 text-mars" />
          <h1 className="text-xl font-semibold">Session Archive</h1>
          {data && (
            <Pill tone={data.storage === 'supabase' ? 'success' : 'muted'} icon={data.storage === 'supabase' ? <Database className="size-3" /> : <HardDrive className="size-3" />}>
              {data.storage === 'supabase' ? 'Stored in Supabase Postgres' : 'Local file store'}
            </Pill>
          )}
          <Link href="/" className="ml-auto text-sm text-info hover:underline">
            ← Live council
          </Link>
        </header>
        <p className="text-sm text-muted-foreground">Every council is kept: Reset archives the session instead of deleting it. History survives restarts and redeploys.</p>
        {error && <p className="text-sm text-danger">{error}</p>}
        {!data && !error && <div className="h-40 animate-pulse rounded-[10px] bg-panel" />}
        {data && data.sessions.length === 0 && <p className="text-sm text-muted-foreground">No sessions yet.</p>}
        {data && (
          <ul className="flex flex-col gap-2">
            {data.sessions.map((s) => {
              const current = s.id === data.currentSessionId;
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-[10px] border bg-panel p-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="num text-sm">
                      {new Date(s.createdAt).toLocaleDateString()} {clock(s.createdAt)} <span className="text-muted-foreground">· {s.id.slice(0, 8)}</span>
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      {s.summary.scenarios.length === 0 && <Pill>not started</Pill>}
                      {s.summary.scenarios.map((sc) => (
                        <Pill key={sc.id} tone={sc.outcome ? (OUTCOME_TONE[sc.outcome] ?? 'muted') : 'muted'}>
                          {sc.id} {sc.kind === 'BASELINE' ? 'Baseline' : sc.title} · {sc.outcome ?? 'in progress'}
                          {sc.approvedPlanVersion ? ` v${sc.approvedPlanVersion}` : ''}
                        </Pill>
                      ))}
                    </span>
                  </div>
                  <span className="num ml-auto text-xs text-muted-foreground">
                    {s.summary.messageCount} messages · {s.summary.planCount} plans · {s.summary.mode}
                  </span>
                  {current ? (
                    <Link href="/" className="rounded-md border border-mars/50 px-3 py-1 text-sm text-mars">
                      Current · open live
                    </Link>
                  ) : (
                    <Link href={`/sessions/${s.id}`} className="rounded-md border px-3 py-1 text-sm hover:bg-panel-2">
                      Open
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </TooltipProvider>
  );
}

export function ArchivedSession({ id }: { id: string }) {
  const [data, setData] = useState<SessionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .session(id)
      .then((d) => alive && setData(d))
      .catch((e: unknown) => alive && setError(e instanceof ApiError && e.status === 404 ? 'Session not found for this instance.' : e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [id]);
  if (error)
    return (
      <main className="mx-auto flex max-w-xl flex-col gap-3 p-8">
        <p className="text-danger">{error}</p>
        <Link href="/sessions" className="text-info hover:underline">
          ← Session Archive
        </Link>
      </main>
    );
  if (!data) return <main className="m-6 h-60 animate-pulse rounded-[10px] bg-panel" aria-busy="true" />;
  return <ArchivedDashboard state={data.state} messages={data.messages} />;
}
