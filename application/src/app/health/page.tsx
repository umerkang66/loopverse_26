'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Activity, ArrowLeft, CheckCircle2, Database, KeyRound, RefreshCw, ShieldAlert, Sparkles, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface HealthData {
  ok: boolean;
  version: string;
  mode: 'live' | 'offline';
  circuitOpen: boolean;
  models: { commander: string; departments: string; fallback: string };
  modelCheck: Record<string, string>;
  tracing: boolean;
  storage: {
    driver: string;
    state: string;
    pendingCount: number;
    lastSyncAt: string | null;
    error: string | null;
    leaseWarning?: boolean;
    host?: string | null;
  };
  rowCounts: Record<string, number> | null;
  memory: { messages: number; plans: number; votes: number; commitments: number };
  sessionId: string;
  instanceId: string;
  dataDir: string;
  run: { status: string; round: number };
  judgeCodeRequired: boolean;
}

export default function HealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/health?deep=1', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 10_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur px-4 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-4" /> Back to Mission Control
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="font-semibold text-foreground">System Health</span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/architecture" className="rounded-md border bg-panel px-3 py-1.5 text-xs font-medium hover:bg-panel-2">
              Architecture Diagram →
            </Link>
            <Button size="sm" variant="outline" onClick={fetchHealth} disabled={loading} className="gap-1.5">
              <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 flex flex-col gap-6">
        {/* Title */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Activity className="size-6 text-mars" /> System Health & Telemetry
            </h1>
            <p className="text-sm text-muted-foreground">
              Live diagnostics, model latency checks, storage write-behind buffer, and database row counts.
            </p>
          </div>
          {data && (
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${data.ok ? 'bg-success/15 text-success border border-success/30' : 'bg-danger/15 text-danger border border-danger/30'}`}>
                <span className={`size-2 rounded-full ${data.ok ? 'bg-success' : 'bg-danger'}`} />
                {data.ok ? 'SYSTEM OPERATIONAL' : 'SYSTEM DEGRADED'}
              </span>
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 p-4 text-sm text-danger flex items-center gap-2">
            <AlertTriangle className="size-4" /> Failed to query /api/health: {error}
          </div>
        )}

        {data && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Runtime & Credentials Card */}
            <section className="rounded-xl border bg-panel p-4 flex flex-col gap-3">
              <h3 className="font-semibold text-sm flex items-center gap-2 border-b pb-2">
                <KeyRound className="size-4 text-mars" /> Runtime & Credentials
              </h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded bg-panel-2 p-2.5 flex flex-col gap-0.5">
                  <span className="text-muted-foreground">Agent Mode</span>
                  <span className="font-semibold text-sm capitalize">{data.mode}</span>
                  <span className="text-[10px] text-muted-foreground">{data.mode === 'live' ? 'Live OpenAI API calls' : 'Rule-based fallback (no keys)'}</span>
                </div>
                <div className="rounded bg-panel-2 p-2.5 flex flex-col gap-0.5">
                  <span className="text-muted-foreground">API Key</span>
                  <span className={`font-semibold text-sm ${data.mode === 'live' ? 'text-success' : 'text-amber'}`}>
                    {data.mode === 'live' ? 'Present (Protected)' : 'Not Set'}
                  </span>
                  <span className="text-[10px] text-muted-foreground">Server-only; never leaked to browser</span>
                </div>
                <div className="rounded bg-panel-2 p-2.5 flex flex-col gap-0.5">
                  <span className="text-muted-foreground">Platform Tracing</span>
                  <span className="font-semibold text-sm">{data.tracing ? 'Enabled (on)' : 'Off'}</span>
                  <span className="text-[10px] text-muted-foreground">OpenAI Traces attached to messages</span>
                </div>
                <div className="rounded bg-panel-2 p-2.5 flex flex-col gap-0.5">
                  <span className="text-muted-foreground">Circuit Breaker</span>
                  <span className={`font-semibold text-sm ${data.circuitOpen ? 'text-danger' : 'text-success'}`}>
                    {data.circuitOpen ? 'OPEN (Tripped)' : 'CLOSED (Normal)'}
                  </span>
                  <span className="text-[10px] text-muted-foreground">Auto-trips on API outages</span>
                </div>
              </div>
            </section>

            {/* Storage & Write-behind Card */}
            <section className="rounded-xl border bg-panel p-4 flex flex-col gap-3">
              <h3 className="font-semibold text-sm flex items-center gap-2 border-b pb-2">
                <Database className="size-4 text-mars" /> Storage Engine
              </h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded bg-panel-2 p-2.5 flex flex-col gap-0.5">
                  <span className="text-muted-foreground">Driver</span>
                  <span className="font-semibold text-sm uppercase">{data.storage.driver}</span>
                  <span className="text-[10px] text-muted-foreground">{data.storage.driver === 'supabase' ? 'Supabase Postgres 17' : 'Local file snapshot'}</span>
                </div>
                <div className="rounded bg-panel-2 p-2.5 flex flex-col gap-0.5">
                  <span className="text-muted-foreground">Sync State</span>
                  <span className={`font-semibold text-sm ${data.storage.state === 'SYNCED' ? 'text-success' : 'text-amber'}`}>
                    {data.storage.state}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{data.storage.pendingCount} dirty rows pending</span>
                </div>
                <div className="rounded bg-panel-2 p-2.5 flex flex-col gap-0.5">
                  <span className="text-muted-foreground">Instance ID</span>
                  <span className="font-mono text-xs">{data.instanceId}</span>
                  <span className="text-[10px] text-muted-foreground">Deployment namespace</span>
                </div>
                <div className="rounded bg-panel-2 p-2.5 flex flex-col gap-0.5">
                  <span className="text-muted-foreground">Local Snapshot Path</span>
                  <span className="font-mono text-[11px] truncate">{data.dataDir}</span>
                  <span className="text-[10px] text-muted-foreground">Crash buffer safe</span>
                </div>
              </div>
              {data.storage.leaseWarning && (
                <div className="rounded bg-amber/10 border border-amber/30 p-2 text-xs text-amber flex items-center gap-2">
                  <AlertTriangle className="size-3.5" /> Another writer detected for this instance ID.
                </div>
              )}
            </section>

            {/* Models Card */}
            <section className="rounded-xl border bg-panel p-4 flex flex-col gap-3">
              <h3 className="font-semibold text-sm flex items-center gap-2 border-b pb-2">
                <Sparkles className="size-4 text-mars" /> Configured Models
              </h3>
              <div className="flex flex-col gap-2 text-xs">
                <div className="flex items-center justify-between rounded bg-panel-2 p-2.5">
                  <div>
                    <div className="font-medium">Commander Agent</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{data.models.commander}</div>
                  </div>
                  <span className={`rounded px-2 py-0.5 text-[10px] font-mono ${data.modelCheck[data.models.commander] === 'ok' ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'}`}>
                    {data.modelCheck[data.models.commander] ?? 'ready'}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded bg-panel-2 p-2.5">
                  <div>
                    <div className="font-medium">Department Agents</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{data.models.departments}</div>
                  </div>
                  <span className={`rounded px-2 py-0.5 text-[10px] font-mono ${data.modelCheck[data.models.departments] === 'ok' ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'}`}>
                    {data.modelCheck[data.models.departments] ?? 'ready'}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded bg-panel-2 p-2.5">
                  <div>
                    <div className="font-medium">Fallback Model</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{data.models.fallback}</div>
                  </div>
                  <span className={`rounded px-2 py-0.5 text-[10px] font-mono ${data.modelCheck[data.models.fallback] === 'ok' ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'}`}>
                    {data.modelCheck[data.models.fallback] ?? 'ready'}
                  </span>
                </div>
              </div>
            </section>

            {/* In-Memory Session Counts Card */}
            <section className="rounded-xl border bg-panel p-4 flex flex-col gap-3">
              <h3 className="font-semibold text-sm flex items-center gap-2 border-b pb-2">
                <Activity className="size-4 text-mars" /> Session Activity ({data.sessionId.slice(0, 8)}…)
              </h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded bg-panel-2 p-2.5 flex flex-col gap-0.5">
                  <span className="text-muted-foreground">Messages</span>
                  <span className="font-semibold text-base font-mono">{data.memory.messages}</span>
                </div>
                <div className="rounded bg-panel-2 p-2.5 flex flex-col gap-0.5">
                  <span className="text-muted-foreground">Plans Drafted</span>
                  <span className="font-semibold text-base font-mono">{data.memory.plans}</span>
                </div>
                <div className="rounded bg-panel-2 p-2.5 flex flex-col gap-0.5">
                  <span className="text-muted-foreground">Ballots Cast</span>
                  <span className="font-semibold text-base font-mono">{data.memory.votes}</span>
                </div>
                <div className="rounded bg-panel-2 p-2.5 flex flex-col gap-0.5">
                  <span className="text-muted-foreground">Commitments</span>
                  <span className="font-semibold text-base font-mono">{data.memory.commitments}</span>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* Database Table Row Counts (when deep=1) */}
        {data?.rowCounts && (
          <section className="rounded-xl border bg-panel p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Database className="size-4 text-mars" /> Supabase Database Row Counts (?deep=1)
              </h3>
              <span className="text-xs text-muted-foreground font-mono">11 ares_* tables</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 text-xs">
              {Object.entries(data.rowCounts).map(([table, count]) => (
                <div key={table} className="rounded bg-panel-2 p-2.5 flex items-center justify-between">
                  <span className="font-mono text-muted-foreground">{table.replace('ares_', '')}</span>
                  <span className="font-mono font-semibold text-foreground">{count}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Framework & Versions Footer */}
        <section className="rounded-xl border bg-panel-2 p-4 text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span>ares-accord v{data?.version ?? '0.1.0'}</span>
            <span>Next.js 16.4.0 (React 19.3.0)</span>
            <span>OpenAI Agents SDK 0.20.0</span>
            <span>@supabase/supabase-js 2.117.3</span>
          </div>
          <div>Node.js {typeof process !== 'undefined' ? process.version : '>=22.9'}</div>
        </section>
      </main>
    </div>
  );
}
