'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, FileUp, Sparkles, Wand2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { RESOURCE_LABEL } from '@/domain/constants';
import { EVENT_PRESETS, INITIAL_POOL, SCENARIO } from '@/domain/scenario';
import { MODE_IDS, RESOURCE_KEYS, type EventEffect, type ModeId, type PublicState, type ResourceKey } from '@/domain/types';
import type { InterpretRequestBody, InterpretResponse } from '@/domain/api';
import { applyEffects } from '@/engine/events';
import { evaluateAll } from '@/engine/optimizer';
import { basePolicy, overridePolicy } from '@/engine/policy';
import { api } from '@/client/api';
import { useAres, type UiState } from '@/client/store';
import { currentScenario } from '@/client/selectors';
import { mmss } from '@/client/format';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Pill } from '../bits';
import { CertificateCard } from '../certificate-card';

type TabId = 'presets' | 'json' | 'manual' | (string & {});

interface IntakeTab {
  id: TabId;
  label: string;
  icon: ReactNode;
  render: (ctx: TabContext) => ReactNode;
}

interface TabContext {
  setRequest: (r: InterpretRequestBody | null, error?: string | null) => void;
  request: InterpretRequestBody | null;
}

const OFFICIAL_JSON = JSON.stringify(SCENARIO.officialSampleEvent, null, 2);

type Preset = UiState['injectPreset'];

function manualEffects(deltas: Partial<Record<string, number>> | undefined): EventEffect[] {
  return RESOURCE_KEYS.filter((k) => (deltas?.[k] ?? 0) !== 0).map((k) => ({ type: 'RESOURCE_DELTA' as const, resource: k, value: deltas![k]! }));
}

/** The request a tab starts with, so "Preview impact" works without retyping. */
function initialRequest(tab: TabId, preset: Preset): InterpretRequestBody | null {
  if (tab === 'json') return { kind: 'json', input: SCENARIO.officialSampleEvent };
  if (tab === 'manual' && preset?.manualDeltas) {
    const effects = manualEffects(preset.manualDeltas);
    return effects.length ? { kind: 'manual', title: preset.title ?? 'Manual adjustment', effects } : null;
  }
  return null;
}

/** Tab registry: Phase 3 adds "Describe in words" (LLM interpreter) here. */
export const INTAKE_TABS: IntakeTab[] = [
  { id: 'presets', label: 'Practice presets', icon: <Zap className="size-3.5" />, render: (ctx) => <PresetsTab {...ctx} /> },
  { id: 'json', label: 'JSON', icon: <FileUp className="size-3.5" />, render: (ctx) => <JsonTab {...ctx} /> },
  { id: 'manual', label: 'Quick manual', icon: <Wand2 className="size-3.5" />, render: (ctx) => <ManualTab {...ctx} /> },
];

export function InjectEventDialog() {
  const open = useAres((s) => s.ui.dialogs.inject);
  const openDialog = useAres((s) => s.openDialog);
  const setUi = useAres((s) => s.setUi);
  const preset = useAres((s) => s.ui.injectPreset);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        openDialog('inject', o);
        if (!o) setUi({ injectPreset: null });
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[920px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="size-4 text-amber" /> Inject event
          </DialogTitle>
          <DialogDescription>Preview the deterministic impact first — the council reconvenes only when you apply it.</DialogDescription>
        </DialogHeader>
        {open && <InjectBody key={preset ? JSON.stringify(preset) : 'plain'} />}
      </DialogContent>
    </Dialog>
  );
}

function InjectBody() {
  const state = useAres((s) => s.state);
  const preset = useAres((s) => s.ui.injectPreset);
  const openDialog = useAres((s) => s.openDialog);
  const setUi = useAres((s) => s.setUi);
  const [tab, setTab] = useState<TabId>(preset?.tab ?? 'presets');
  const [request, setRequestState] = useState<InterpretRequestBody | null>(() => initialRequest(preset?.tab ?? 'presets', preset));
  const [inputError, setInputError] = useState<string | null>(null);
  const [preview, setPreview] = useState<InterpretResponse | null>(null);
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const sc = state ? currentScenario(state) : null;
  const running = sc?.status === 'NEGOTIATING';

  const setRequest = (r: InterpretRequestBody | null, error: string | null = null) => {
    setRequestState(r);
    setInputError(error);
    setPreview(null);
  };

  const runPreview = async () => {
    if (!request) return;
    setBusy('preview');
    try {
      setPreview(await api.interpret(request));
    } catch {
      // toast shown
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!preview) return;
    setBusy('apply');
    try {
      const res = await api.apply(preview.interpretation);
      openDialog('inject', false);
      setUi({ injectPreset: null, focusScenarioId: null, autoScroll: true, rightTab: 'board' });
      toast.success(`Event recorded — council reconvening in ${res.scenarioId} (deadline ${mmss((state?.config.eventDeadlineSec ?? 170) * 1000)})`);
    } catch {
      // toast shown
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v);
          setRequest(initialRequest(v, preset));
        }}
      >
        <TabsList>
          {INTAKE_TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className="gap-1.5">
              {t.icon} {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {INTAKE_TABS.map((t) => (
          <TabsContent key={t.id} value={t.id} className="pt-3">
            {tab === t.id && t.render({ setRequest, request })}
          </TabsContent>
        ))}
      </Tabs>
      {inputError && <p className="text-sm text-danger">{inputError}</p>}
      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={() => void runPreview()} disabled={!request || busy !== null}>
          <Sparkles /> {busy === 'preview' ? 'Previewing…' : 'Preview impact'}
        </Button>
        <span className="text-xs text-muted-foreground">Nothing changes until you apply.</span>
      </div>
      {preview && state && <EventPreview preview={preview} state={state} />}
      {running && preview && (
        <p className="flex items-center gap-2 rounded-md border border-amber/40 bg-amber/10 px-3 py-2 text-sm text-amber">
          <AlertTriangle className="size-4" /> A negotiation is in progress ({sc?.id}, round {sc?.round}). Applying interrupts it — {sc?.id} is recorded as INTERRUPTED.
        </p>
      )}
      <DialogFooter>
        <Button variant="ghost" onClick={() => openDialog('inject', false)}>
          Cancel
        </Button>
        <Button onClick={() => void apply()} disabled={!preview || busy !== null}>
          <Zap /> {busy === 'apply' ? 'Applying…' : running ? 'Interrupt & reconvene council' : 'Apply & reconvene council'}
        </Button>
      </DialogFooter>
    </div>
  );
}

function PresetsTab({ setRequest, request }: TabContext) {
  const selected = request?.kind === 'preset' ? request.presetId : null;
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {EVENT_PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          aria-pressed={selected === p.id}
          onClick={() => setRequest({ kind: 'preset', presetId: p.id })}
          className={cn('flex flex-col gap-1 rounded-lg border p-3 text-left', selected === p.id ? 'border-amber bg-amber/10' : 'bg-panel-2 hover:border-amber/40')}
        >
          <span className="flex items-center gap-2 font-medium">
            <Zap className="size-3.5 text-amber" /> {p.name}
          </span>
          <span className="text-xs text-muted-foreground">{p.description}</span>
          <span className="num text-[10px] text-muted-foreground">{p.id}</span>
        </button>
      ))}
    </div>
  );
}

function JsonTab({ setRequest }: TabContext) {
  const [text, setText] = useState(OFFICIAL_JSON);
  const [error, setError] = useState<string | null>(null);
  const check = (value: string) => {
    setText(value);
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The event must be a JSON object.');
      setError(null);
      setRequest({ kind: 'json', input: parsed });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Invalid JSON';
      setError(msg);
      setRequest(null);
    }
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 100_000) return setError('File too large (max 100 KB).');
    check(await file.text());
  };
  return (
    <div className="flex flex-col gap-2">
      <Textarea value={text} onChange={(e) => check(e.target.value)} className="num h-64 text-xs" spellCheck={false} aria-label="Event JSON" aria-invalid={!!error} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs hover:bg-panel-2">
          <FileUp className="size-3.5" /> Upload .json
          <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => void upload(e.target.files?.[0])} />
        </label>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            try {
              check(JSON.stringify(JSON.parse(text), null, 2));
            } catch {
              // the error is already shown
            }
          }}
        >
          Format
        </Button>
        <Button size="sm" variant="ghost" onClick={() => check(OFFICIAL_JSON)}>
          Official sample (CRISIS_002)
        </Button>
        {error ? <span className="text-xs text-danger">JSON error: {error}</span> : <span className="text-xs text-success">Valid JSON · event_injection_format.json</span>}
      </div>
    </div>
  );
}

type Unit = 'units' | 'percent';

function ManualTab({ setRequest }: TabContext) {
  const preset = useAres((s) => s.ui.injectPreset);
  const [title, setTitle] = useState(preset?.title ?? 'Manual adjustment');
  const [values, setValues] = useState<Record<ResourceKey, string>>(() =>
    Object.fromEntries(RESOURCE_KEYS.map((k) => [k, preset?.manualDeltas?.[k] !== undefined ? String(preset.manualDeltas[k]) : ''])) as Record<ResourceKey, string>,
  );
  const [units, setUnits] = useState<Record<ResourceKey, Unit>>(() => Object.fromEntries(RESOURCE_KEYS.map((k) => [k, 'units'])) as Record<ResourceKey, Unit>);
  const [reserves, setReserves] = useState<Record<ResourceKey, string>>(() => Object.fromEntries(RESOURCE_KEYS.map((k) => [k, ''])) as Record<ResourceKey, string>);
  const [riskLimit, setRiskLimit] = useState('');
  const [forbidden, setForbidden] = useState<ModeId[]>([]);

  const build = (next: { values?: typeof values; units?: typeof units; reserves?: typeof reserves; riskLimit?: string; forbidden?: ModeId[]; title?: string }) => {
    const v = next.values ?? values;
    const u = next.units ?? units;
    const r = next.reserves ?? reserves;
    const rl = next.riskLimit ?? riskLimit;
    const fb = next.forbidden ?? forbidden;
    const effects: EventEffect[] = [];
    for (const k of RESOURCE_KEYS) {
      const n = Number(v[k]);
      if (v[k].trim() && Number.isFinite(n) && n !== 0) effects.push(u[k] === 'percent' ? { type: 'RESOURCE_PERCENT', resource: k, value: n } : { type: 'RESOURCE_DELTA', resource: k, value: Math.round(n) });
      const res = Number(r[k]);
      if (r[k].trim() && Number.isInteger(res) && res > 0) effects.push({ type: 'RESERVE_REQUIREMENT', resource: k, value: res });
    }
    const risk = Number(rl);
    if (rl.trim() && Number.isInteger(risk)) effects.push({ type: 'RISK_LIMIT', value: risk });
    for (const m of fb) effects.push({ type: 'FORBID_MODE', modeId: m, reason: 'Forbidden by Mission Control' });
    setRequest(effects.length ? { kind: 'manual', title: (next.title ?? title).trim() || 'Manual adjustment', effects } : null);
  };

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-sm">
        Title
        <Input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            build({ title: e.target.value });
          }}
          className="h-8 max-w-sm"
        />
      </label>
      <table className="w-full max-w-xl text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="text-left font-normal">Resource</th>
            <th className="text-left font-normal">Change (±)</th>
            <th className="text-left font-normal">Unit</th>
            <th className="text-left font-normal">Required reserve</th>
          </tr>
        </thead>
        <tbody>
          {RESOURCE_KEYS.map((k) => (
            <tr key={k}>
              <td className="py-0.5 pr-2">{RESOURCE_LABEL[k].name}</td>
              <td className="py-0.5 pr-2">
                <Input
                  aria-label={`${RESOURCE_LABEL[k].name} change`}
                  value={values[k]}
                  placeholder="0"
                  onChange={(e) => {
                    const next = { ...values, [k]: e.target.value.replace(/[^0-9.-]/g, '') };
                    setValues(next);
                    build({ values: next });
                  }}
                  className="num h-8 w-24"
                />
              </td>
              <td className="py-0.5 pr-2">
                <select
                  aria-label={`${RESOURCE_LABEL[k].name} unit`}
                  value={units[k]}
                  onChange={(e) => {
                    const next = { ...units, [k]: e.target.value as Unit };
                    setUnits(next);
                    build({ units: next });
                  }}
                  className="h-8 rounded-md border bg-panel-2 px-2 text-xs"
                >
                  <option value="units">units</option>
                  <option value="percent">%</option>
                </select>
              </td>
              <td className="py-0.5">
                <Input
                  aria-label={`${RESOURCE_LABEL[k].name} required reserve`}
                  value={reserves[k]}
                  placeholder="—"
                  onChange={(e) => {
                    const next = { ...reserves, [k]: e.target.value.replace(/[^0-9]/g, '') };
                    setReserves(next);
                    build({ reserves: next });
                  }}
                  className="num h-8 w-20"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          Risk limit
          <Input
            value={riskLimit}
            placeholder="24"
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9]/g, '');
              setRiskLimit(v);
              build({ riskLimit: v });
            }}
            className="num h-8 w-16"
          />
        </label>
        <span className="text-sm">Forbidden modes</span>
        <div className="flex flex-wrap gap-1">
          {MODE_IDS.map((m) => {
            const on = forbidden.includes(m);
            return (
              <button
                key={m}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const next = on ? forbidden.filter((x) => x !== m) : [...forbidden, m];
                  setForbidden(next);
                  build({ forbidden: next });
                }}
                className={cn('num rounded-[6px] border px-1.5 py-0.5 text-xs', on ? 'border-danger bg-danger/15 text-danger' : 'text-muted-foreground')}
              >
                {m}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EventPreview({ preview, state }: { preview: InterpretResponse; state: PublicState }) {
  const { interpretation: it, forecast: f } = preview;
  const inForceVersion = state.planInForceVersion;
  return (
    <section className="flex flex-col gap-3 rounded-[10px] border border-amber/40 bg-amber/5 p-3" aria-label="Event preview">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{it.title}</span>
        <Pill tone="muted">{it.source}</Pill>
        <span className="num text-xs text-muted-foreground">confidence {(it.confidence * 100).toFixed(0)}%</span>
      </div>
      {it.summary && <p className="text-sm text-muted-foreground">{it.summary}</p>}
      {it.warnings.length > 0 && (
        <ul className="text-xs text-amber">
          {it.warnings.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto]">
        <div className="flex flex-col gap-1">
          <span className="panel-title">Effects</span>
          {f.effects.length === 0 && <span className="text-sm text-muted-foreground">No resource effect.</span>}
          {f.effects.map((e, i) => (
            <span key={i} className="num text-sm">
              • {e}
            </span>
          ))}
        </div>
        <table className="num text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="text-left font-normal">Pool</th>
              <th className="text-right font-normal">Before</th>
              <th className="text-right font-normal">After</th>
              <th className="text-right font-normal">Δ</th>
            </tr>
          </thead>
          <tbody>
            {RESOURCE_KEYS.map((k) => {
              const d = f.poolAfter[k] - f.poolBefore[k];
              return (
                <tr key={k} className={d ? 'font-semibold' : 'text-muted-foreground'}>
                  <td>{RESOURCE_LABEL[k].name}</td>
                  <td className="text-right">{f.poolBefore[k]}</td>
                  <td className="text-right">{f.poolAfter[k]}</td>
                  <td className={cn('text-right', d < 0 && 'text-danger', d > 0 && 'text-success')}>{d ? (d > 0 ? `+${d}` : d) : '·'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <MiniHeatmap preview={preview} state={state} />
      </div>
      <div className="flex flex-col gap-1 text-sm">
        <span className="panel-title">Forecast</span>
        {f.previousPlanWouldBe && inForceVersion ? (
          <span className={f.previousPlanWouldBe === 'INVALID' ? 'text-danger' : 'text-amber'}>
            Plan in force v{inForceVersion} would become {f.previousPlanWouldBe}
            {f.previousPlanReasons.length ? ` (${f.previousPlanReasons.join('; ')})` : ' — it still fits, but needs four fresh votes'}
          </span>
        ) : (
          <span className="text-muted-foreground">No plan in force yet.</span>
        )}
        <span>
          Feasible plans: <span className="num font-semibold text-success">{f.feasibleBase}</span> under baseline limits · <span className="num font-semibold text-teal">{f.feasibleOverride}</span> under Crisis Override
          {f.feasibleBase === 0 && f.feasibleOverride > 0 && <span className="text-amber"> — the Commander will need Crisis Override</span>}
        </span>
        {f.certificate && (
          <div className="pt-1">
            <CertificateCard cert={f.certificate} sc={null} compact />
          </div>
        )}
      </div>
    </section>
  );
}

function MiniHeatmap({ preview, state }: { preview: InterpretResponse; state: PublicState }) {
  const cells = useMemo(() => {
    const prev = state.scenarios[state.scenarios.length - 1];
    const base = prev ?? { pool: INITIAL_POOL, reserveRequirements: {}, forbiddenModes: [], riskCap: null, maxSacrificesCap: null, priorities: [] };
    const applied = applyEffects(base, preview.interpretation.effects);
    const constraints = { pool: applied.pool, reserveRequirements: applied.reserveRequirements, forbiddenModes: applied.forbiddenModes, riskCap: applied.riskCap, maxSacrificesCap: applied.maxSacrificesCap };
    const baseEval = evaluateAll(constraints, basePolicy());
    const overrideEval = evaluateAll(constraints, overridePolicy());
    return baseEval.map((e, i) => (e.feasible ? 'base' : overrideEval[i]!.feasible ? 'override' : 'none'));
  }, [preview, state.scenarios]);
  return (
    <div className="flex flex-col gap-1">
      <span className="panel-title">81 combinations</span>
      <div className="grid w-[126px] grid-cols-9 gap-px" role="img" aria-label="Feasibility after the event">
        {cells.map((c, i) => (
          <span key={i} className={cn('size-3 rounded-[2px]', c === 'base' ? 'bg-success' : c === 'override' ? 'border border-teal bg-teal/20' : 'bg-danger/30')} />
        ))}
      </div>
      <span className="text-[10px] text-muted-foreground">green: baseline · teal: override only</span>
    </div>
  );
}
