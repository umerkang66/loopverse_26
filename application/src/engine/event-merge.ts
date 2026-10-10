// Pure validation and merge of Event Intake (LLM) effects with the deterministic parser's effects.
// The LLM can only ADD what the parser missed; it can never overrule a number the parser read.
import { DEPARTMENT_IDS, MODE_IDS, RESOURCE_KEYS, type EffectOrigin, type EventEffect, type EventInterpretation } from '@/domain/types';

/** Shape of one effect as emitted by the strict-mode schema (all fields present, unused ones null). */
export interface RawIntakeEffect {
  type: string;
  resource: string | null;
  value: number | null;
  modeId: string | null;
  department: string | null;
  sourceKey: string | null;
  note: string;
}

export interface RawIntake {
  title: string;
  summary: string;
  effects: RawIntakeEffect[];
  durationHours: number | null;
  triggerHour: number | null;
  requiresReplan: boolean;
  messageToCommander: string | null;
  confidence: number;
  assumptions: string[];
}

export const MAX_EFFECTS = 12;

const isResource = (v: unknown): v is (typeof RESOURCE_KEYS)[number] => RESOURCE_KEYS.includes(v as never);
const isMode = (v: unknown): v is (typeof MODE_IDS)[number] => MODE_IDS.includes(v as never);
const isDept = (v: unknown): v is (typeof DEPARTMENT_IDS)[number] => DEPARTMENT_IDS.includes(v as never);
const within = (v: number | null, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** Types, bounds, and known ids: anything else is dropped with a warning. */
export function sanitizeIntakeEffects(raw: readonly RawIntakeEffect[]): { effects: EventEffect[]; warnings: string[] } {
  const effects: EventEffect[] = [];
  const warnings: string[] = [];
  const drop = (e: RawIntakeEffect, why: string) => warnings.push(`Event Intake effect ${e.type}${e.resource ? ` ${e.resource}` : ''}${e.modeId ? ` ${e.modeId}` : ''} dropped: ${why}`);
  for (const e of raw) {
    if (effects.length >= MAX_EFFECTS) {
      warnings.push(`Event Intake returned more than ${MAX_EFFECTS} effects; the rest were ignored`);
      break;
    }
    const note = (e.note || e.sourceKey || e.type).slice(0, 400);
    switch (e.type) {
      case 'RESOURCE_DELTA':
        if (isResource(e.resource) && within(e.value, -999, 999)) effects.push({ type: e.type, resource: e.resource, value: Math.round(e.value) });
        else drop(e, 'needs a known resource and a value within ±999');
        break;
      case 'RESOURCE_PERCENT':
        if (isResource(e.resource) && within(e.value, -100, 500)) effects.push({ type: e.type, resource: e.resource, value: e.value });
        else drop(e, 'needs a known resource and a percent within −100..+500');
        break;
      case 'RESOURCE_SET':
        if (isResource(e.resource) && within(e.value, 0, 999)) effects.push({ type: e.type, resource: e.resource, value: Math.round(e.value) });
        else drop(e, 'needs a known resource and a value within 0..999');
        break;
      case 'RESERVE_REQUIREMENT':
        if (isResource(e.resource) && within(e.value, 0, 999)) effects.push({ type: e.type, resource: e.resource, value: Math.round(e.value) });
        else drop(e, 'needs a known resource and units within 0..999');
        break;
      case 'FORBID_MODE':
        if (isMode(e.modeId)) effects.push({ type: e.type, modeId: e.modeId, reason: note });
        else drop(e, 'unknown mode id');
        break;
      case 'ALLOW_MODE':
        if (isMode(e.modeId)) effects.push({ type: e.type, modeId: e.modeId });
        else drop(e, 'unknown mode id');
        break;
      case 'RISK_LIMIT':
        if (within(e.value, 4, 60)) effects.push({ type: e.type, value: Math.round(e.value) });
        else drop(e, 'risk limit must be within 4..60');
        break;
      case 'MAX_SACRIFICES':
        if (within(e.value, 0, 4)) effects.push({ type: e.type, value: Math.round(e.value) });
        else drop(e, 'sacrifice cap must be within 0..4');
        break;
      case 'PRIORITY':
        effects.push({ type: e.type, department: isDept(e.department) ? e.department : null, note });
        break;
      case 'INFO':
        effects.push({ type: e.type, note });
        break;
      default:
        warnings.push(`Event Intake effect of unknown type "${e.type}" dropped`);
    }
  }
  return { effects, warnings };
}

const stamp = (effects: readonly EventEffect[], origin: EffectOrigin): EventEffect[] => effects.map((e) => ({ ...e, origin: e.origin ?? origin }));

/** Which pool resource (or policy slot) an effect pins down. Used to let the parser win on keys it understood. */
function slotOf(e: EventEffect): string | null {
  switch (e.type) {
    case 'RESOURCE_DELTA':
    case 'RESOURCE_PERCENT':
    case 'RESOURCE_SET':
      return `pool:${e.resource}`;
    case 'RESERVE_REQUIREMENT':
      return `reserve:${e.resource}`;
    case 'RISK_LIMIT':
      return 'risk';
    case 'MAX_SACRIFICES':
      return 'sacrifices';
    case 'FORBID_MODE':
    case 'ALLOW_MODE':
      return `mode:${e.modeId}`;
    default:
      return null;
  }
}

const sameEffect = (a: EventEffect, b: EventEffect) => JSON.stringify({ ...a, origin: undefined }) === JSON.stringify({ ...b, origin: undefined });

/** Parser wins on every slot it already filled; the LLM fills the gaps; disagreements become warnings. */
export function mergeIntake(parsed: EventInterpretation, intake: RawIntake): EventInterpretation {
  const { effects: llmEffects, warnings: dropWarnings } = sanitizeIntakeEffects(intake.effects);
  const warnings = [...parsed.warnings, ...dropWarnings];
  const merged: EventEffect[] = stamp(parsed.effects, 'parser');
  const taken = new Map<string, EventEffect>();
  for (const e of merged) {
    const slot = slotOf(e);
    if (slot) taken.set(slot, e);
  }
  for (const e of llmEffects) {
    if (merged.length >= MAX_EFFECTS) break;
    const slot = slotOf(e);
    if (slot && taken.has(slot)) {
      const mine = taken.get(slot)!;
      if (!sameEffect(mine, e)) warnings.push(`Event Intake disagreed on ${slot.replace(':', ' ')}: kept the parser's value`);
      continue;
    }
    if (!slot && merged.some((m) => m.type === e.type && sameEffect(m, e))) continue;
    const withOrigin = { ...e, origin: 'llm' as const };
    merged.push(withOrigin);
    if (slot) taken.set(slot, withOrigin);
  }
  const hadParser = parsed.effects.length > 0;
  return {
    title: parsed.title && parsed.title !== 'Unnamed event' && !parsed.title.startsWith('Judge-described') ? parsed.title : intake.title || parsed.title,
    summary: parsed.summary && parsed.summary !== parsed.title ? parsed.summary : intake.summary || parsed.summary,
    effects: merged,
    durationHours: parsed.durationHours ?? intake.durationHours,
    triggerHour: parsed.triggerHour ?? intake.triggerHour,
    requiresReplan: typeof (parsed.raw as { requires_replan?: unknown } | null)?.requires_replan === 'boolean' ? parsed.requiresReplan : intake.requiresReplan,
    messageToCommander: parsed.messageToCommander ?? intake.messageToCommander,
    source: hadParser ? 'HYBRID' : 'LLM',
    confidence: Math.min(1, Math.max(0, intake.confidence)),
    warnings,
    assumptions: [...new Set([...parsed.assumptions, ...intake.assumptions])],
    raw: parsed.raw,
  };
}

/** Fast-path result: nothing for the LLM to add. */
export function stampParser(parsed: EventInterpretation): EventInterpretation {
  return { ...parsed, effects: stamp(parsed.effects, 'parser') };
}

/** Deterministic parse shown when the LLM is unavailable. */
export function intakeOffline(parsed: EventInterpretation, reason: string): EventInterpretation {
  return {
    ...stampParser(parsed),
    warnings: [`Event Intake offline — deterministic parse shown; edit effects if needed (${reason})`, ...parsed.warnings],
  };
}
