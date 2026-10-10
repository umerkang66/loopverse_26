'use client';

import { useMemo } from 'react';
import { motion } from 'motion/react';
import { ShieldAlert, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RESOURCE_LABEL } from '@/domain/constants';
import { getMode, SCENARIO } from '@/domain/scenario';
import { DEPARTMENT_IDS, type CouncilMessage, type Plan, type PublicState, type Scenario } from '@/domain/types';
import { describeEffect } from '@/engine/events';
import { useAres } from '@/client/store';
import {
  PROTOCOL_STEPS,
  boardPlan,
  currentScenario,
  focusScenario,
  limitsOf,
  phaseStep,
  requestedSelections,
  resourceRows,
  type ResourceRow,
} from '@/client/selectors';
import { ACTOR_META } from '@/client/theme';
import { AgentEmblem, PanelTitle, Pill, Tip } from './bits';

/** Start offset of each segment in a stacked bar. */
function cumulative(values: number[]): number[] {
  return values.map((_, i) => values.slice(0, i).reduce((a, b) => a + b, 0));
}

export function MissionControl() {
  const state = useAres((s) => s.state);
  const messages = useAres((s) => s.messages);
  const focusId = useAres((s) => s.ui.focusScenarioId);
  const showInForce = useAres((s) => s.ui.showPlanInForce);
  if (!state) return <section className="h-[150px] animate-pulse rounded-[10px] border bg-panel" />;
  const sc = focusScenario(state, focusId);
  const plan = boardPlan(state, sc, showInForce);
  return (
    <section aria-labelledby="mission-control" className="flex flex-col gap-2.5 rounded-[10px] border bg-panel p-3">
      <PanelTitle right={sc && <RoundTracker sc={sc} />}>
        <span id="mission-control">Mission Control</span>
      </PanelTitle>
      <EventBanner state={state} sc={sc} messages={messages} />
      {sc ? (
        <>
          <Gauges state={state} sc={sc} plan={plan} />
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <RiskMeter sc={sc} plan={plan} />
            <SacrificeSlots sc={sc} plan={plan} />
            <ProtocolStepper state={state} sc={sc} messages={messages} />
          </div>
        </>
      ) : (
        <IdleGauges />
      )}
    </section>
  );
}

function EventBanner({ state, sc, messages }: { state: PublicState; sc: Scenario | null; messages: CouncilMessage[] }) {
  const denied = useMemo(() => (sc ? messages.some((m) => m.scenarioId === sc.id && m.subtype === 'OVERRIDE_DENIED') : false), [messages, sc]);
  const openDialog = useAres((s) => s.openDialog);
  const setUi = useAres((s) => s.setUi);
  if (!sc || sc.kind === 'BASELINE') {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-panel-2 px-3 py-2 text-sm">
        <Pill tone="info">BASELINE</Pill>
        <span className="font-medium">{SCENARIO.title}</span>
        <span className="text-muted-foreground">
          ({SCENARIO.colony.crew} crew, {SCENARIO.colony.injured} injured)
        </span>
        <span className="meta-secondary hidden text-muted-foreground 2xl:inline">— {SCENARIO.narrative}</span>
      </div>
    );
  }
  const record = state.events.find((e) => e.id === sc.eventId);
  const effects = record ? record.interpretation.effects.filter((e) => e.type !== 'INFO').map((e) => describeEffect(e, record.poolBefore)) : [];
  const triggerHour = record?.interpretation.triggerHour ?? sc.colonyHour;
  const duration = record?.interpretation.durationHours;

  const endEarly = () => {
    if (!record) return;
    const deltas: Record<string, number> = {};
    for (const e of record.interpretation.effects) {
      if (e.type === 'RESOURCE_DELTA' && e.resource && typeof e.value === 'number') {
        deltas[e.resource] = (deltas[e.resource] ?? 0) - e.value;
      } else if (e.type === 'RESOURCE_PERCENT' && e.resource) {
        const diff = record.poolBefore[e.resource] - record.poolAfter[e.resource];
        deltas[e.resource] = (deltas[e.resource] ?? 0) + diff;
      }
    }
    setUi({ injectPreset: { tab: 'manual', manualDeltas: deltas, title: `Resolution: ${sc.title} ended early` } });
    openDialog('inject');
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber/40 bg-amber/5 px-3 py-2 text-sm">
      <Pill tone="amber" icon={<Zap className="size-3" />}>
        EVENT {sc.id}
      </Pill>
      <span className="font-medium">{sc.title}</span>
      {effects.length > 0 && <span className="num text-amber">— {effects.join(' · ')}</span>}
      {duration ? <span className="text-muted-foreground">· Temporary: until Hour {triggerHour + duration}</span> : null}
      <span className="meta-secondary text-muted-foreground">· colony hour {sc.colonyHour}</span>
      {sc.policy.crisisOverride ? (
        <Pill tone="amber" icon={<ShieldAlert className="size-3" />}>
          CRISIS OVERRIDE ACTIVE (risk ≤ {limitsOf(sc).riskLimit} · ≤ {limitsOf(sc).maxSacrifices} Sacrifice)
        </Pill>
      ) : denied ? (
        <Pill tone="muted">Override denied — baseline plan exists</Pill>
      ) : null}
      {sc.forbiddenModes.length > 0 && <Pill tone="danger">Forbidden: {sc.forbiddenModes.join(', ')}</Pill>}
      {duration && sc.status !== 'RESOLVED' && (
        <button
          type="button"
          onClick={endEarly}
          className="ml-auto inline-flex items-center gap-1 rounded bg-panel-2 px-2 py-0.5 text-xs font-medium text-amber border border-amber/40 hover:bg-amber/10"
        >
          End event early
        </button>
      )}
    </div>
  );
}

function IdleGauges() {
  return (
    <p className="text-sm text-muted-foreground">
      Council standing by. Enter the available resources and press <span className="text-mars">Start crisis</span> — gauges, risk, and the protocol stepper go live here.
    </p>
  );
}

function Gauges({ state, sc, plan }: { state: PublicState; sc: Scenario; plan: Plan | null }) {
  const rows = resourceRows(plan, sc, requestedSelections(state));
  return (
    <div className="grid grid-cols-1 gap-x-5 gap-y-1.5 md:grid-cols-2 xl:grid-cols-3">
      {rows.map((r) => (
        <ResourceGauge key={r.key} row={r} />
      ))}
    </div>
  );
}

function ResourceGauge({ row }: { row: ResourceRow }) {
  const scale = Math.max(row.available, row.used, row.requestedUsed ?? 0, 1);
  const pct = (v: number) => `${(v / scale) * 100}%`;
  const offsets = cumulative(row.segments.map((s) => s.value));
  const tooltip = row.segments.length
    ? row.segments.map((s) => `${ACTOR_META[s.dept].callsign} ${s.mode}: ${s.value}`).join(' · ')
    : 'No plan on the table yet';
  return (
    <div className="grid grid-cols-[72px_1fr_auto] items-center gap-2 text-xs">
      <span className="text-muted-foreground">{RESOURCE_LABEL[row.key].name}</span>
      <Tip content={`${tooltip}${row.requestedUsed !== null ? ` · requested combination: ${row.requestedUsed}` : ''}${row.reserveRequired ? ` · ${row.reserveRequired} held in required reserve` : ''}`}>
        <div className="relative h-3.5 rounded-sm" role="img" aria-label={`${RESOURCE_LABEL[row.key].name}: ${row.used} used of ${row.available}${row.over ? `, over by ${row.over}` : ''}`}>
          <div className="absolute inset-y-0 left-0 rounded-sm bg-panel-2 ring-1 ring-border" style={{ width: pct(row.available) }} />
          {row.reserveRequired > 0 && <div className="hatch-muted absolute inset-y-0" style={{ left: pct(row.cap), width: pct(row.reserveRequired) }} />}
          {row.segments.map((s, i) => (
            <motion.div
              key={s.dept}
              className="absolute inset-y-0.5"
              initial={false}
              animate={{ left: pct(offsets[i]!), width: pct(s.value) }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              style={{ backgroundColor: ACTOR_META[s.dept].color, opacity: 0.85 }}
            />
          ))}
          {row.over > 0 && <div className="hatch-danger absolute inset-y-0 rounded-r-sm" style={{ left: pct(row.cap), width: pct(row.over) }} />}
          {row.requestedUsed !== null && (
            <div className="absolute -inset-y-0.5 w-0.5 bg-foreground/70" style={{ left: pct(Math.min(row.requestedUsed, scale)) }} title="Requested combination" />
          )}
        </div>
      </Tip>
      <span className="num w-[112px] text-right">
        <span className={row.over ? 'font-semibold text-danger' : undefined}>{row.used}</span>
        <span className="text-muted-foreground">/{row.available}</span>
        {row.over > 0 ? <span className="text-danger"> +{row.over}</span> : <span className="text-muted-foreground"> · reserve {row.leftover}</span>}
      </span>
    </div>
  );
}

function RiskMeter({ sc, plan }: { sc: Scenario; plan: Plan | null }) {
  const { riskLimit } = limitsOf(sc);
  const risk = plan?.risk ?? 0;
  const scale = Math.max(riskLimit, risk, 1) * 1.08;
  const risks = plan ? DEPARTMENT_IDS.map((d) => getMode(plan.selections[d]).risk) : [];
  const offsets = cumulative(risks);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">Risk</span>
      <Tip content={plan ? DEPARTMENT_IDS.map((d) => `${ACTOR_META[d].callsign} ${plan.selections[d]}: ${getMode(plan.selections[d]).risk}`).join(' · ') : 'No plan yet'}>
        <div className="relative h-3.5 w-48 rounded-sm bg-panel-2 ring-1 ring-border" role="img" aria-label={`Risk ${risk} of limit ${riskLimit}`}>
          {plan &&
            DEPARTMENT_IDS.map((d, i) => (
              <motion.div
                key={d}
                className="absolute inset-y-0.5 border-r border-background"
                initial={false}
                animate={{ left: `${(offsets[i]! / scale) * 100}%`, width: `${(risks[i]! / scale) * 100}%` }}
                transition={{ duration: 0.3 }}
                style={{ backgroundColor: ACTOR_META[d].color, opacity: 0.85 }}
              />
            ))}
          <div className="absolute -inset-y-1 w-0.5 bg-foreground" style={{ left: `${(riskLimit / scale) * 100}%` }} />
        </div>
      </Tip>
      <span className={cn('num', risk > riskLimit ? 'font-semibold text-danger' : undefined)}>
        {risk}/{riskLimit}
      </span>
    </div>
  );
}

function SacrificeSlots({ sc, plan }: { sc: Scenario; plan: Plan | null }) {
  const { maxSacrifices } = limitsOf(sc);
  const sacrifices = plan?.sacrifices ?? [];
  const slots = Math.max(maxSacrifices, sacrifices.length);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">Sacrifice</span>
      <span className="flex gap-1" role="img" aria-label={`${sacrifices.length} of ${maxSacrifices} sacrifice slots used`}>
        {Array.from({ length: slots }, (_, i) => {
          const dept = sacrifices[i];
          return dept ? (
            <Tip key={i} content={`${ACTOR_META[dept].callsign} runs ${plan?.selections[dept]} (Sacrifice)`}>
              <span className={cn(i >= maxSacrifices && 'rounded-full ring-2 ring-danger')}>
                <AgentEmblem id={dept} size={20} />
              </span>
            </Tip>
          ) : (
            <span key={i} className="inline-block size-5 rounded-full border border-dashed border-muted-foreground/50" />
          );
        })}
      </span>
      <span className="num">
        {sacrifices.length}/{maxSacrifices}
      </span>
    </div>
  );
}

function ProtocolStepper({ state, sc, messages }: { state: PublicState; sc: Scenario; messages: CouncilMessage[] }) {
  const isCurrent = currentScenario(state)?.id === sc.id;
  const step = sc.status === 'RESOLVED' ? 8 : isCurrent ? phaseStep(state.run, messages) : 0;
  return (
    <ol className="flex flex-wrap items-center gap-1 text-[11px]" aria-label="Protocol steps">
      <span className="mr-1 text-muted-foreground">Protocol</span>
      {PROTOCOL_STEPS.map((label, i) => {
        const n = i + 1;
        const active = n === step;
        const done = n < step;
        return (
          <li
            key={label}
            aria-current={active ? 'step' : undefined}
            className={cn(
              'rounded-[6px] border px-1.5 py-0.5',
              active ? 'border-mars bg-mars/15 font-semibold text-foreground' : done ? 'border-success/30 text-success' : 'border-border text-muted-foreground',
            )}
          >
            <span className="num">{n}</span> {label}
          </li>
        );
      })}
    </ol>
  );
}

function RoundTracker({ sc }: { sc: Scenario }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground" aria-label={`Round ${sc.round} of ${sc.maxRounds}`}>
      Rounds
      {Array.from({ length: sc.maxRounds }, (_, i) => {
        const n = i + 1;
        return (
          <Tip key={n} content={n === sc.minRoundsBeforeApproval ? `Round ${n}: voting opens` : `Round ${n}`}>
            <span className="relative inline-flex">
              <span className={cn('inline-block size-2.5 rounded-full border', n <= sc.round ? 'border-mars bg-mars' : 'border-muted-foreground/50')} />
              {n === sc.minRoundsBeforeApproval && <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[8px] text-amber">▼</span>}
            </span>
          </Tip>
        );
      })}
      <span className="num ml-1">
        {sc.round}/{sc.maxRounds}
      </span>
    </div>
  );
}
