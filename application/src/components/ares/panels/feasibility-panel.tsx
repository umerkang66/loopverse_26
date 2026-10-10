'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { INITIAL_POOL } from '@/domain/scenario';
import type { CouncilMessage, ModeId, Scenario, Selections } from '@/domain/types';
import { evaluateCombination, type CombinationEval } from '@/engine/optimizer';
import { basePolicy, constraintsOf, overridePolicy, type ScenarioConstraints } from '@/engine/policy';
import { certifyInfeasibility } from '@/engine/infeasibility';
import { capOf, total } from '@/engine/resources';
import { useAres } from '@/client/store';
import { focusDraft, focusScenario, planInForce } from '@/client/selectors';
import { ACTOR_META } from '@/client/theme';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tip, VecVs } from '../bits';
import { CertificateCard } from '../certificate-card';

const ROWS: [ModeId, ModeId][] = (['L1', 'L2', 'L3'] as const).flatMap((l) => (['M1', 'M2', 'M3'] as const).map((m) => [l, m] as [ModeId, ModeId]));
const COLS: [ModeId, ModeId][] = (['F1', 'F2', 'F3'] as const).flatMap((f) => (['E1', 'E2', 'E3'] as const).map((e) => [f, e] as [ModeId, ModeId]));

type CellKind = 'feasible' | 'override' | 'policy' | 'resources' | 'forbidden';

interface Cell {
  sel: Selections;
  key: string;
  current: CombinationEval;
  override: CombinationEval;
  kind: CellKind;
}

function classify(e: CombinationEval, overrideOk: boolean, viewOverride: boolean): CellKind {
  if (e.violations.includes('FORBIDDEN')) return 'forbidden';
  if (e.feasible) return 'feasible';
  if (!viewOverride && overrideOk) return 'override';
  if (!e.violations.includes('RESOURCES')) return 'policy';
  return 'resources';
}

export function FeasibilityPanel() {
  const state = useAres((s) => s.state);
  const messages = useAres((s) => s.messages);
  const focusId = useAres((s) => s.ui.focusScenarioId);
  const [policyView, setPolicyView] = useState<'current' | 'override'>('current');
  const [selected, setSelected] = useState<string | null>(null);
  const sc = state ? focusScenario(state, focusId) : null;
  const constraints: ScenarioConstraints = useMemo(
    () => (sc ? constraintsOf(sc) : { pool: INITIAL_POOL, reserveRequirements: {}, forbiddenModes: [], riskCap: null, maxSacrificesCap: null }),
    [sc],
  );
  const currentPolicy = sc?.policy ?? basePolicy();
  const viewOverride = policyView === 'override';
  const cells = useMemo(() => {
    const out = new Map<string, Cell>();
    for (const [l, m] of ROWS) {
      for (const [f, e] of COLS) {
        const sel: Selections = { LIFE_SUPPORT: l, MEDICAL: m, FOOD: f, ENGINEERING: e };
        const current = evaluateCombination(sel, constraints, viewOverride ? overridePolicy() : currentPolicy);
        const override = evaluateCombination(sel, constraints, overridePolicy());
        out.set(current.key, { sel, key: current.key, current, override, kind: classify(current, override.feasible, viewOverride) });
      }
    }
    return out;
  }, [constraints, currentPolicy, viewOverride]);

  if (!state) return null;
  const cap = capOf(constraints.pool, constraints.reserveRequirements);
  const all = [...cells.values()];
  const feasibleNow = all.filter((c) => c.current.feasible).length;
  const feasibleOverride = all.filter((c) => c.override.feasible).length;
  const maxOver = Math.max(1, ...all.map((c) => total(c.current.overages)));
  const draft = focusDraft(state, sc);
  const inForce = planInForce(state);
  const draftKey = draft ? keyOf(draft.selections) : null;
  const inForceKey = inForce ? keyOf(inForce.selections) : null;
  const requested = requestedKeys(messages, sc);
  const overrideAvailable = sc?.kind === 'EVENT' && sc.overrideAvailable;
  const allowedFeasible = feasibleNow + (overrideAvailable && !sc?.policy.crisisOverride ? feasibleOverride : 0);
  const sel = selected ? cells.get(selected) : null;
  const certificate = sc && allowedFeasible === 0 && !viewOverride ? (sc.certificate ?? certifyInfeasibility(constraints, { levels: [{ name: 'current limits', policy: currentPolicy }, ...(overrideAvailable && !currentPolicy.crisisOverride ? [{ name: 'Crisis Override', policy: overridePolicy() }] : [])] })) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs">
          <span className="num font-semibold text-success">{feasibleNow}</span> of 81 feasible under {viewOverride ? 'Crisis Override' : sc?.policy.crisisOverride ? 'Crisis Override (active)' : 'baseline limits'} ·{' '}
          <span className="num font-semibold text-teal">{feasibleOverride}</span> with override
          {!overrideAvailable && <span className="text-muted-foreground"> (override not available before an event)</span>}
        </p>
        <ToggleGroup type="single" size="sm" variant="outline" value={policyView} onValueChange={(v) => v && setPolicyView(v as 'current' | 'override')}>
          <ToggleGroupItem value="current">Current policy</ToggleGroupItem>
          <ToggleGroupItem value="override">Crisis Override</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="grid gap-px text-[9px]" style={{ gridTemplateColumns: '42px repeat(9, minmax(0, 1fr))' }} role="grid" aria-label="Feasibility of all 81 mode combinations">
        <span />
        {COLS.map(([f, e]) => (
          <span key={f + e} className="num pb-0.5 text-center text-muted-foreground" role="columnheader">
            {f}
            {e}
          </span>
        ))}
        {ROWS.map(([l, m]) => (
          <Row key={l + m} label={`${l}${m}`}>
            {COLS.map(([f, e]) => {
              const k = `${l}+${m}+${f}+${e}`;
              const cell = cells.get(k)!;
              return (
                <HeatCell
                  key={k}
                  cell={cell}
                  maxOver={maxOver}
                  cap={cap}
                  isDraft={k === draftKey}
                  isInForce={k === inForceKey}
                  requested={requested.has(k)}
                  selected={selected === k}
                  onSelect={() => setSelected(selected === k ? null : k)}
                />
              );
            })}
          </Row>
        ))}
      </div>
      <Legend />
      {sel && <EvaluatePanel cell={sel} cap={cap} />}
      {certificate && <CertificateCard cert={certificate} sc={sc} />}
      <p className="text-[11px] text-muted-foreground">
        The Commander calls <span className="num text-info">list_feasible_plans</span> and departments call <span className="num text-info">evaluate_combination</span> on this same deterministic engine — see the 🔧 chips in the
        transcript. The optimizer advises; the validator decides; the agents negotiate who bears the cost.
      </p>
    </div>
  );
}

const keyOf = (s: Selections) => `${s.LIFE_SUPPORT}+${s.MEDICAL}+${s.FOOD}+${s.ENGINEERING}`;

function requestedKeys(messages: CouncilMessage[], sc: Scenario | null): Set<string> {
  const out = new Set<string>();
  if (!sc) return out;
  for (const m of messages) {
    if (m.scenarioId !== sc.id || m.type !== 'COUNTEROFFER') continue;
    const sel = (m.data as { selections?: Selections }).selections;
    if (sel) out.add(keyOf(sel));
  }
  return out;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="num flex items-center text-muted-foreground" role="rowheader">
        {label}
      </span>
      {children}
    </>
  );
}

function HeatCell(props: { cell: Cell; maxOver: number; cap: Record<string, number>; isDraft: boolean; isInForce: boolean; requested: boolean; selected: boolean; onSelect: () => void }) {
  const { cell, maxOver, isDraft, isInForce, requested, selected, onSelect } = props;
  const e = cell.current;
  const over = total(e.overages);
  const style: React.CSSProperties =
    cell.kind === 'resources' ? { backgroundColor: `color-mix(in oklch, var(--danger) ${18 + Math.round((over / maxOver) * 62)}%, transparent)` } : {};
  const label = `${cell.key}: ${cell.kind === 'feasible' ? 'feasible' : cell.kind === 'override' ? 'feasible only with Crisis Override' : cell.kind === 'policy' ? `resources fit but ${e.violations.join(', ').toLowerCase()} violated` : cell.kind === 'forbidden' ? 'uses a forbidden mode' : `over by ${over}`}`;
  return (
    <Tip
      content={
        <span className="flex flex-col gap-1">
          <span className="num font-semibold">{cell.key}</span>
          <VecVs totals={e.totals} cap={props.cap as never} className="text-[11px]" />
          <span className="num">
            risk {e.risk} · {e.sacrifices.length} sacrifice(s){e.violations.length ? ` · violates ${e.violations.join(', ')}` : ' · feasible'}
          </span>
          {isDraft && <span className="text-mars">Current draft</span>}
          {isInForce && <span>Plan in force</span>}
          {requested && <span className="text-info">Proposed in a counteroffer</span>}
        </span>
      }
    >
      <button
        type="button"
        role="gridcell"
        aria-label={label}
        aria-selected={selected}
        onClick={onSelect}
        style={style}
        className={cn(
          'relative aspect-square min-h-[26px] rounded-[3px] border transition-transform hover:scale-110 focus-visible:scale-110',
          cell.kind === 'feasible' && 'border-success/60 bg-success/70',
          cell.kind === 'override' && 'border-2 border-teal bg-teal/10',
          cell.kind === 'policy' && 'border-amber/50 bg-amber/40',
          cell.kind === 'resources' && 'border-danger/30',
          cell.kind === 'forbidden' && 'hatch-muted border-border',
          isDraft && 'ring-2 ring-mars ring-offset-1 ring-offset-background',
          isInForce && !isDraft && 'ring-2 ring-foreground ring-offset-1 ring-offset-background',
          selected && 'outline-2 outline-info',
        )}
      >
        {requested && <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-info" aria-hidden />}
        {cell.kind === 'feasible' && <span className="text-[9px] font-bold text-background">✓</span>}
      </button>
    </Tip>
  );
}

function Legend() {
  const item = (cls: string, text: string) => (
    <span className="flex items-center gap-1">
      <span className={cn('inline-block size-3 rounded-[2px] border', cls)} /> {text}
    </span>
  );
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {item('border-success/60 bg-success/70', 'feasible')}
      {item('border-2 border-teal bg-teal/10', 'only with Crisis Override')}
      {item('border-amber/50 bg-amber/40', 'fits, but risk/sacrifice limit')}
      {item('border-danger/30 bg-danger/60', 'resource overflow (darker = more)')}
      {item('hatch-muted border-border', 'forbidden mode')}
      <span className="flex items-center gap-1">
        <span className="inline-block size-3 rounded-[2px] ring-2 ring-mars" /> current draft
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block size-3 rounded-[2px] ring-2 ring-foreground" /> plan in force
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block size-1.5 rounded-full bg-info" /> counteroffer
      </span>
    </div>
  );
}

function EvaluatePanel({ cell, cap }: { cell: Cell; cap: Record<string, number> }) {
  const e = cell.current;
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-info/40 bg-info/5 p-2.5 text-xs">
      <span className="panel-title">evaluate_combination({cell.key})</span>
      <VecVs totals={e.totals} cap={cap as never} />
      <span className="num">
        risk {e.risk} · sacrifices {e.sacrifices.map((d) => ACTOR_META[d].callsign).join(', ') || 'none'} · reserve {Object.values(e.reserve).join('/')}
      </span>
      <span className={e.feasible ? 'text-success' : 'text-danger'}>
        {e.feasible ? 'Feasible under this policy' : `Violations: ${e.violations.join(', ')}`}
        {!e.feasible && cell.override.feasible ? ' · feasible with Crisis Override' : ''}
      </span>
    </div>
  );
}
