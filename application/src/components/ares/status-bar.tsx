'use client';

import Link from 'next/link';
import { CircleHelp, Database, Radio, Settings, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PublicState, Scenario } from '@/domain/types';
import { useAres } from '@/client/store';
import { currentScenario, focusDraft, focusScenario, modeIndicator, planInForce, runStatusLabel, storageBadge, voteCounts } from '@/client/selectors';
import { mmss } from '@/client/format';
import { useNow } from '@/client/use-now';
import { PLAN_STATUS_TONE, TONE_CLASS, OUTCOME_TONE } from '@/client/theme';
import { Button } from '@/components/ui/button';
import { Pill, Tip, VersionChip } from './bits';
import { ControlsMenu } from './judge-controls';

export function StatusBar({ archived = false }: { archived?: boolean }) {
  const state = useAres((s) => s.state);
  if (!state) return <header className="header-grid sticky top-0 z-30 h-[52px] border-b bg-background/90 backdrop-blur" />;
  return (
    <header className="header-grid sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
      <div className="flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-wide">
          <span className="inline-block size-2.5 rounded-full bg-mars shadow-[0_0_10px_var(--mars)]" aria-hidden />
          ARES ACCORD
          <span className="meta-secondary font-normal text-muted-foreground">· Colony Council</span>
        </Link>
        <ScenarioSwitcher state={state} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <RunStatus state={state} />
          <PlanChip state={state} />
          <Countdown state={state} />
          {!archived && <ModeBadge state={state} />}
          <StorageBadge state={state} />
          {!archived && <ConnectionDot />}
          {!archived && <ControlsMenu />}
          <SettingsButton />
          <HelpButton />
        </div>
      </div>
    </header>
  );
}

function ScenarioSwitcher({ state }: { state: PublicState }) {
  const focusId = useAres((s) => s.ui.focusScenarioId);
  const setUi = useAres((s) => s.setUi);
  const current = currentScenario(state);
  const focus = focusScenario(state, focusId);
  if (state.scenarios.length === 0) return null;
  return (
    <nav aria-label="Scenarios" className="flex flex-wrap items-center gap-1.5">
      {state.scenarios.map((sc) => {
        const active = focus?.id === sc.id;
        const live = sc.status === 'NEGOTIATING';
        return (
          <button
            key={sc.id}
            type="button"
            onClick={() => setUi({ focusScenarioId: sc.id === current?.id ? null : sc.id })}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-[6px] border px-2 py-1 text-xs transition-colors',
              active ? 'border-mars/60 bg-mars/10 text-foreground' : 'border-border bg-panel text-muted-foreground hover:text-foreground',
            )}
            aria-pressed={active}
          >
            <span className="num font-semibold">{sc.id}</span>
            <span className="max-w-[160px] truncate">{sc.kind === 'BASELINE' ? 'Baseline' : sc.title}</span>
            {live ? (
              <span className="num text-mars">● R{sc.round}</span>
            ) : sc.outcome ? (
              <span className={cn('num', TONE_CLASS[OUTCOME_TONE[sc.outcome] ?? 'muted'].split(' ')[0])}>
                {sc.outcome === 'APPROVED' ? '✓' : '■'} {sc.outcome}
                {sc.approvedPlanVersion ? ` v${sc.approvedPlanVersion}` : ''}
              </span>
            ) : (
              <span className="text-muted-foreground">{sc.status}</span>
            )}
          </button>
        );
      })}
      {focusId && focusId !== current?.id && (
        <button type="button" onClick={() => setUi({ focusScenarioId: null })} className="rounded-[6px] border border-info/40 bg-info/10 px-2 py-1 text-xs text-info">
          Follow live ({current?.id})
        </button>
      )}
    </nav>
  );
}

function RunStatus({ state }: { state: PublicState }) {
  const sc = currentScenario(state);
  const status = runStatusLabel(state, sc);
  return (
    <span className="flex items-center gap-1.5">
      <Pill tone={status.tone} className="text-xs">
        {status.label === 'NEGOTIATING' && <span className="size-1.5 animate-pulse rounded-full bg-mars" />}
        {status.label}
      </Pill>
      {sc && sc.status !== 'PENDING' && (
        <span className="num text-xs text-muted-foreground">
          R{sc.round}/{sc.maxRounds}
        </span>
      )}
    </span>
  );
}

function PlanChip({ state }: { state: PublicState }) {
  const focusId = useAres((s) => s.ui.focusScenarioId);
  const setUi = useAres((s) => s.setUi);
  const sc = focusScenario(state, focusId);
  const plan = focusDraft(state, sc) ?? planInForce(state);
  if (!plan) return <Pill>No plan yet</Pill>;
  const votes = voteCounts(plan);
  return (
    <button
      type="button"
      onClick={() => setUi({ rightTab: 'history', selectedPlanVersion: plan.version })}
      className="inline-flex items-center gap-1.5 rounded-[6px] border border-border bg-panel px-2 py-1 text-xs hover:border-mars/50"
      aria-label={`Plan version ${plan.version}, ${plan.status}. Open plan history`}
    >
      <span className="text-muted-foreground">Plan</span>
      <VersionChip version={plan.version} hash={plan.hash} />
      <span className={cn('rounded-[6px] border px-1.5 py-0.5 text-[11px]', TONE_CLASS[PLAN_STATUS_TONE[plan.status]])}>
        {plan.status}
        {(plan.status === 'VOTING' || votes.accept + votes.reject > 0) && <span className="num"> {votes.accept}/4</span>}
      </span>
    </button>
  );
}

/** mm:ss until the scenario deadline; amber at 25 % left, red at 10 %. Resolved → "Resolved in m:ss". */
export function Countdown({ state, scenario }: { state: PublicState; scenario?: Scenario | null }) {
  const now = useNow(1000);
  const sc = scenario ?? currentScenario(state);
  if (!sc || sc.status === 'PENDING') return null;
  if (sc.resolvedAt && sc.startedAt) {
    const took = Date.parse(sc.resolvedAt) - Date.parse(sc.startedAt);
    const ok = sc.kind === 'BASELINE' || took <= 180_000;
    return (
      <Tip content={sc.kind === 'EVENT' ? 'PDF requirement: a new plan or a justified INFEASIBLE within 3 minutes of an event.' : 'Time from Start to the result.'}>
        <span>
          <Pill tone={ok ? 'success' : 'amber'} icon={<Timer className="size-3" />}>
            Resolved in <span className="num">{mmss(took)}</span>
          </Pill>
        </span>
      </Tip>
    );
  }
  if (!sc.deadlineAt) return null;
  const left = Date.parse(sc.deadlineAt) - now;
  const totalMs = sc.startedAt ? Date.parse(sc.deadlineAt) - Date.parse(sc.startedAt) : 300_000;
  const frac = left / Math.max(1, totalMs);
  const tone = frac <= 0.1 ? 'danger' : frac <= 0.25 ? 'amber' : 'muted';
  return (
    <Tip content={`Deadline for ${sc.id}: the council must reach a result before it expires.`}>
      <span>
        <Pill tone={tone} icon={<Timer className="size-3" />} className="text-xs">
          <span className="num">{mmss(left)}</span>
        </Pill>
      </span>
    </Tip>
  );
}

function ModeBadge({ state }: { state: PublicState }) {
  const messages = useAres((s) => s.messages);
  const now = useNow(5000);
  const mode = modeIndicator(state, messages, now);
  return (
    <Tip content={mode.detail}>
      <span>
        <Pill tone={mode.tone}>{mode.label}</Pill>
      </span>
    </Tip>
  );
}

function StorageBadge({ state }: { state: PublicState }) {
  const setUi = useAres((s) => s.setUi);
  const openDialog = useAres((s) => s.openDialog);
  const badge = storageBadge(state.storage);
  return (
    <Tip content={badge.detail}>
      <button
        type="button"
        onClick={() => {
          setUi({ settingsFocus: 'database' });
          openDialog('settings');
        }}
        className={cn('inline-flex max-w-[260px] items-center gap-1 truncate rounded-[6px] border px-1.5 py-0.5 text-[11px] font-medium', TONE_CLASS[badge.tone])}
      >
        <Database className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{badge.label}</span>
      </button>
    </Tip>
  );
}

function ConnectionDot() {
  const connection = useAres((s) => s.connection);
  const color = connection === 'live' ? 'bg-success' : connection === 'offline' ? 'bg-danger' : 'bg-amber animate-pulse';
  return (
    <Tip content={`Live stream: ${connection}`}>
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" role="status" aria-label={`Live stream ${connection}`}>
        <Radio className="size-3" aria-hidden />
        <span className={cn('size-2 rounded-full', color)} />
        <span className="meta-secondary">{connection}</span>
      </span>
    </Tip>
  );
}

function SettingsButton() {
  const openDialog = useAres((s) => s.openDialog);
  return (
    <Tip content="Settings: configuration, presentation mode, database">
      <Button variant="ghost" size="icon-sm" onClick={() => openDialog('settings')} aria-label="Settings">
        <Settings />
      </Button>
    </Tip>
  );
}

function HelpButton() {
  const openDialog = useAres((s) => s.openDialog);
  return (
    <Tip content="How to read this dashboard">
      <Button variant="ghost" size="icon-sm" onClick={() => openDialog('help')} aria-label="Help">
        <CircleHelp />
      </Button>
    </Tip>
  );
}
