'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Database, ExternalLink, ShieldAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import type { HealthResponse } from '@/domain/api';
import type { DbTable, PublicState } from '@/domain/types';
import { api, getJudgeCode, setJudgeCode } from '@/client/api';
import { useAres } from '@/client/store';
import { storageBadge } from '@/client/selectors';
import { ago } from '@/client/format';
import { useNow } from '@/client/use-now';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Pill } from '../bits';

/** Phase 3 appends sections here (Resilience Lab, search). */
export const SETTINGS_SECTIONS: { id: string; render: () => ReactNode }[] = [];

export function SettingsSheet() {
  const open = useAres((s) => s.ui.dialogs.settings);
  const openDialog = useAres((s) => s.openDialog);
  const setUi = useAres((s) => s.setUi);
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        openDialog('settings', o);
        if (!o) setUi({ settingsFocus: null });
      }}
    >
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto bg-panel sm:max-w-[560px]">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>Read-only configuration, presentation, access, and the persistence layer.</SheetDescription>
        </SheetHeader>
        {open && <SettingsBody />}
      </SheetContent>
    </Sheet>
  );
}

function SettingsBody() {
  const state = useAres((s) => s.state);
  const readOnly = useAres((s) => s.readOnly);
  const presentation = useAres((s) => s.ui.presentation);
  const setUi = useAres((s) => s.setUi);
  const [code, setCode] = useState(() => getJudgeCode());
  if (!state) return null;
  const c = state.config;
  return (
    <div className="flex flex-col gap-4 p-4 pt-0">
      <section className="flex flex-col gap-1.5 rounded-lg border bg-panel-2 p-3 text-sm">
        <h3 className="panel-title">Configuration</h3>
        <Row k="Agents" v={c.mode === 'live' ? 'LIVE (OpenAI Agents SDK)' : 'OFFLINE (labeled rule-based fallback)'} />
        <Row k="Commander model" v={`${c.models.commander} · effort ${c.models.effortCommander}`} />
        <Row k="Department model" v={`${c.models.departments} · effort ${c.models.effortDepartments}`} />
        <Row k="Fallback model" v={c.models.fallback} />
        <Row k="Max rounds" v={`baseline ${c.maxRoundsBaseline} · event ${c.maxRoundsEvent}`} />
        <Row k="Deadlines" v={`baseline ${c.baselineDeadlineSec}s · event ${c.eventDeadlineSec}s`} />
        <Row k="Timeouts" v={`model call ${c.modelCallTimeoutMs} ms · agent turn ${c.agentTurnTimeoutMs} ms`} />
        <Row k="Human countersign" v={c.hitl.enabled ? `on (risk > ${c.hitl.riskThreshold})` : 'off'} />
        <a href="/api/health" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 pt-1 text-xs text-info hover:underline">
          /api/health <ExternalLink className="size-3" />
        </a>
      </section>

      <section className="flex flex-col gap-2 rounded-lg border bg-panel-2 p-3">
        <h3 className="panel-title">Presentation</h3>
        <div className="flex items-center gap-2">
          <Switch
            id="presentation"
            checked={presentation}
            onCheckedChange={(v) => {
              setUi({ presentation: v });
              try {
                localStorage.setItem('ares.presentation', v ? '1' : '0');
              } catch {
                // per-viewer preference only
              }
            }}
          />
          <Label htmlFor="presentation">Presentation mode (larger type, less metadata — for projectors and video)</Label>
        </div>
      </section>

      {!readOnly && (
        <section className="flex flex-col gap-2 rounded-lg border bg-panel-2 p-3">
          <h3 className="panel-title">Judge access code</h3>
          <p className="text-xs text-muted-foreground">Only needed when the server sets JUDGE_ACCESS_CODE. Stored in this browser only.</p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setJudgeCode(code.trim());
              toast.success(code.trim() ? 'Access code saved' : 'Access code cleared');
            }}
          >
            <Input type="password" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Judge access code" className="h-8" />
            <Button type="submit" size="sm">
              Save
            </Button>
          </form>
        </section>
      )}

      <DatabaseCard state={state} readOnly={readOnly} />
      {SETTINGS_SECTIONS.map((s) => (
        <div key={s.id}>{s.render()}</div>
      ))}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{k}</span>
      <span className="num text-right">{v}</span>
    </div>
  );
}

function memoryCounts(state: PublicState): Partial<Record<DbTable, number>> {
  return {
    ares_scenarios: state.scenarios.length,
    ares_events: state.events.length,
    ares_plans: state.plans.length,
    ares_plan_validations: state.plans.reduce((n, p) => n + p.validations.length, 0),
    ares_votes: state.plans.reduce((n, p) => n + p.votes.length, 0),
    ares_commitments: state.commitments.length,
    ares_messages: state.messageCount,
    ares_agent_states: Object.keys(state.agents).length,
    ares_agent_memory: Object.values(state.agents).reduce((n, a) => n + a.sessionItemCount, 0),
  };
}

function DatabaseCard({ state, readOnly }: { state: PublicState; readOnly: boolean }) {
  const focus = useAres((s) => s.ui.settingsFocus);
  const ref = useRef<HTMLElement>(null);
  const now = useNow(2000);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirm, setConfirm] = useState('');
  const st = state.storage;
  const badge = storageBadge(st);
  const ref_ = st.project?.split('.')[0];

  useEffect(() => {
    if (focus === 'database') ref.current?.scrollIntoView({ block: 'start' });
  }, [focus]);

  const verify = async () => {
    setChecking(true);
    try {
      setHealth(await api.health(true));
    } catch {
      // toast shown
    } finally {
      setChecking(false);
    }
  };

  const hardReset = async () => {
    try {
      await api.reset({ hard: true, confirm: 'DELETE' });
      toast.success('All sessions of this instance were deleted');
      setConfirm('');
    } catch {
      // toast shown
    }
  };

  const mem = memoryCounts(state);
  const rows = health?.rowCounts ? (Object.keys(mem) as DbTable[]) : [];
  return (
    <section ref={ref} className="flex scroll-mt-4 flex-col gap-2 rounded-lg border bg-panel-2 p-3" aria-labelledby="db-card">
      <h3 id="db-card" className="panel-title flex items-center gap-1.5">
        <Database className="size-3.5" /> Database
      </h3>
      <Pill tone={badge.tone} className="self-start text-xs">
        {badge.label}
      </Pill>
      <Row k="Driver" v={st.driver === 'supabase' ? 'Supabase Postgres' : 'Local file store'} />
      {st.project && <Row k="Project" v={st.project} />}
      <Row k="Instance" v={st.instanceId} />
      <Row k="Sync state" v={`${st.state} · ${st.pendingRows} pending`} />
      <Row k="Last sync" v={ago(st.lastSyncAt, now)} />
      {st.dbMessageCount !== null && <Row k="Messages in DB" v={`${st.dbMessageCount} / ${state.messageCount}`} />}
      {st.lastError && <p className="text-xs text-danger">{st.lastError.hint}</p>}
      {st.leaseWarning && <p className="text-xs text-amber">{st.leaseWarning}</p>}
      {st.driver === 'supabase' && (
        <>
          <Button size="sm" variant="outline" onClick={() => void verify()} disabled={checking} className="self-start">
            {checking ? 'Counting rows…' : 'Verify persistence'}
          </Button>
          {health?.rowCounts && (
            <table className="num w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left font-normal">Table (this session)</th>
                  <th className="text-right font-normal">Rows in Supabase</th>
                  <th className="text-right font-normal">In memory</th>
                  <th className="text-right font-normal" />
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const db = health.rowCounts?.[t];
                  const ok = db === mem[t];
                  return (
                    <tr key={t}>
                      <td>{t}</td>
                      <td className="text-right">{db ?? '—'}</td>
                      <td className="text-right">{mem[t]}</td>
                      <td className="text-right">{ok ? <Check className="ml-auto size-3.5 text-success" aria-label="match" /> : <X className="ml-auto size-3.5 text-amber" aria-label="differs (sync pending)" />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {ref_ && (
            <a href={`https://supabase.com/dashboard/project/${ref_}/editor`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-info hover:underline">
              Open in Supabase Table Editor <ExternalLink className="size-3" />
            </a>
          )}
        </>
      )}
      {st.driver === 'file' && <p className="text-xs text-muted-foreground">Supabase is not configured: every session is kept in the local file store (DATA_DIR) and the archive still works.</p>}
      {!readOnly && (
        <div className="mt-2 flex flex-col gap-2 rounded-md border border-danger/40 bg-danger/5 p-2.5">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-danger">
            <ShieldAlert className="size-3.5" /> Danger zone
          </span>
          <p className="text-xs text-muted-foreground">Delete all sessions for this instance ({st.instanceId}), in the database and on disk. The normal Reset never deletes history.</p>
          <div className="flex gap-2">
            <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Type DELETE" aria-label="Type DELETE to confirm" className="h-8" />
            <Button size="sm" variant="destructive" disabled={confirm !== 'DELETE'} onClick={() => void hardReset()}>
              Delete all
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
