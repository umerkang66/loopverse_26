// Deterministic event intake: the official injection format, presets, unseen JSON keys, and plain-text descriptions.
// Never guesses a magnitude: anything it cannot read becomes a warning (Phase 3 adds an LLM interpreter on top).
import { DEPARTMENT_LABEL, RESOURCE_LABEL } from '@/domain/constants';
import { isModeId } from '@/domain/scenario';
import { modeOf } from './catalog';
import {
  DEPARTMENT_IDS,
  RESOURCE_KEYS,
  type DepartmentId,
  type EventEffect,
  type EventInterpretation,
  type EventSource,
  type ModeId,
  type ModeTier,
  type ResourceKey,
  type ResourceVector,
} from '@/domain/types';

const RESOURCE_ALIASES: Record<string, ResourceKey> = {
  power: 'power', energy: 'power', electric: 'power', electricity: 'power', solar: 'power',
  water: 'water', h2o: 'water',
  oxygen: 'oxygen', o2: 'oxygen', air: 'oxygen',
  robot: 'robot', robots: 'robot', robotics: 'robot', rover: 'robot', drone: 'robot', drones: 'robot',
  bandwidth: 'bandwidth', band: 'bandwidth', comms: 'bandwidth', relay: 'bandwidth', network: 'bandwidth', telemetry: 'bandwidth', uplink: 'bandwidth',
};
const NEGATIVE = new Set(['reduction', 'reduce', 'reduced', 'loss', 'lose', 'lost', 'decrease', 'decreased', 'drop', 'dropped', 'cut', 'damage', 'damaged', 'deficit', 'failure', 'shortage', 'down']);
const POSITIVE = new Set(['increase', 'increased', 'gain', 'boost', 'resupply', 'restore', 'restored', 'delivery', 'surplus', 'bonus', 'up', 'added']);
const SIGNED = new Set(['delta', 'change', 'adjust', 'adjustment', 'diff']);
const PERCENT = new Set(['percent', 'pct', 'percentage']);
const SET_WORDS = new Set(['set', 'available', 'new', 'total', 'capacity', 'now', 'remaining', 'left']);

const META_KEYS = new Set([
  'event_id', 'id', 'event_name', 'name', 'title', 'trigger_time', 'description', 'summary', 'impact', 'requires_replan',
  'message_to_commander', 'duration_hours', 'affected_systems', 'changes', 'effects', 'type', 'severity',
]);

function tokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9%]+/)
    .filter(Boolean);
}

function resourceIn(toks: string[]): ResourceKey | null {
  for (const t of toks) if (RESOURCE_ALIASES[t]) return RESOURCE_ALIASES[t]!;
  return null;
}

/** "-30%", "-4 units", 12 → { value, percent } */
function parseNumber(value: unknown): { value: number; percent: boolean } | null {
  if (typeof value === 'number' && Number.isFinite(value)) return { value, percent: false };
  if (typeof value === 'string') {
    const m = value.trim().match(/^([+-]?\d+(?:\.\d+)?)\s*(%|percent|pct)?/i);
    if (m) return { value: Number(m[1]), percent: Boolean(m[2]) };
  }
  return null;
}

interface ParseCtx {
  effects: EventEffect[];
  warnings: string[];
  assumptions: string[];
  understood: Set<ResourceKey>;
}

/** Container keys that only group other keys; they never name a resource themselves. */
const GENERIC_KEYS = new Set(['impact', 'impacts', 'resources', 'resource', 'effects', 'effect', 'pool', 'details', 'data', 'event', 'consequences']);
const FOOD_WORDS = new Set(['food', 'crop', 'crops', 'harvest', 'hydroponic', 'hydroponics', 'greenhouse', 'yield', 'farm']);

/** Interpret one key/value pair. Returns true if understood. */
function readEntry(key: string, value: unknown, ctx: ParseCtx, leaf = key): boolean {
  const lower = leaf.toLowerCase();
  if (META_KEYS.has(lower)) return true;
  const toks = tokens(key);

  // Policy keys
  if (/^(risk_limit|max_risk|risk_cap|max_combined_risk)$/.test(lower)) {
    const n = parseNumber(value);
    if (n) { ctx.effects.push({ type: 'RISK_LIMIT', value: Math.round(n.value) }); return true; }
  }
  if (/^(max_sacrifices|sacrifice_limit|max_sacrifice_modes)$/.test(lower)) {
    const n = parseNumber(value);
    if (n) { ctx.effects.push({ type: 'MAX_SACRIFICES', value: Math.round(n.value) }); return true; }
  }
  if (/^(forbidden_modes|unavailable_modes|disabled_modes)$/.test(lower) && Array.isArray(value)) {
    for (const m of value) {
      if (isModeId(m)) ctx.effects.push({ type: 'FORBID_MODE', modeId: m, reason: `listed in ${key}` });
      else ctx.warnings.push(`Unknown mode "${String(m)}" in ${key}`);
    }
    return true;
  }
  if (/^(reserve_requirements?|keep_in_reserve|mandated_reserve)$/.test(lower) && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [rk, rv] of Object.entries(value as Record<string, unknown>)) {
      const res = resourceIn(tokens(rk));
      const n = parseNumber(rv);
      if (res && n) ctx.effects.push({ type: 'RESERVE_REQUIREMENT', resource: res, value: Math.max(0, Math.round(n.value)) });
      else ctx.warnings.push(`Could not read reserve requirement "${rk}"`);
    }
    return true;
  }
  if (/^(priority|priorities)$/.test(lower)) {
    const notes = Array.isArray(value) ? value : [value];
    for (const note of notes) {
      const text = typeof note === 'string' ? note : JSON.stringify(note);
      const dept = DEPARTMENT_IDS.find((d) => text.toUpperCase().includes(d) || text.toLowerCase().includes(DEPARTMENT_LABEL[d].toLowerCase())) ?? null;
      ctx.effects.push({ type: 'PRIORITY', department: dept, note: text });
    }
    return true;
  }

  // Resource keys
  const resource = resourceIn(toks);
  if (!resource) {
    // Human-impact keys about food production are not a pool resource: surface them as a priority + note.
    if (toks.some((t) => FOOD_WORDS.has(t)) && value !== null && typeof value !== 'object') {
      const note = `${key} = ${String(value)}`;
      ctx.effects.push({ type: 'PRIORITY', department: 'FOOD', note });
      ctx.effects.push({ type: 'INFO', note: `Food production impact (${note}); not a pool resource, so no units were changed` });
      return true;
    }
    return false;
  }
  if (typeof value === 'boolean' || value === null || typeof value === 'object') {
    ctx.warnings.push(`"${key}" mentions ${RESOURCE_LABEL[resource].name} but has no magnitude; not applied`);
    return false;
  }
  const n = parseNumber(value);
  if (!n) {
    ctx.warnings.push(`"${key}" has a non-numeric value; not applied`);
    return false;
  }
  const hasNeg = toks.some((t) => NEGATIVE.has(t));
  const hasPos = toks.some((t) => POSITIVE.has(t));
  const signed = toks.some((t) => SIGNED.has(t));
  const percent = n.percent || toks.some((t) => PERCENT.has(t) || t === '%');
  const isSet = !hasNeg && !hasPos && !signed && toks.some((t) => SET_WORDS.has(t));
  const bare = toks.length === 1 || (toks.length === 2 && toks[0] === 'robot' && toks[1] === 'time');
  const durationOnly = toks.includes('hours') && !hasNeg && !hasPos && !signed;
  if (durationOnly) {
    ctx.warnings.push(`"${key}" looks like a duration, not a resource change; not applied`);
    ctx.effects.push({ type: 'INFO', note: `${key} = ${String(value)} (duration only, no magnitude for ${RESOURCE_LABEL[resource].name})` });
    ctx.assumptions.push(`${key} gives a duration without a magnitude, so ${RESOURCE_LABEL[resource].name} was not changed.`);
    return true;
  }
  if (!hasNeg && !hasPos && !signed && !isSet && !percent && !bare) {
    ctx.warnings.push(`"${key}" mentions ${RESOURCE_LABEL[resource].name} without a direction or unit; not applied`);
    return false;
  }
  const magnitude = Math.abs(n.value);
  const signedValue = hasNeg ? -magnitude : hasPos ? magnitude : n.value;
  if (isSet) ctx.effects.push({ type: 'RESOURCE_SET', resource, value: Math.max(0, Math.round(n.value)) });
  else if (percent) ctx.effects.push({ type: 'RESOURCE_PERCENT', resource, value: signedValue });
  else ctx.effects.push({ type: 'RESOURCE_DELTA', resource, value: Math.round(signedValue) });
  ctx.understood.add(resource);
  return true;
}

/** Arrays like [{ "resource": "oxygen", "change": -3 }] or [{ "type": "percent", "target": "power", "amount": -25 }]. */
function readChangeArray(items: unknown[], ctx: ParseCtx): void {
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const resource = resourceIn(tokens(String(o.resource ?? o.target ?? o.name ?? '')));
    const n = parseNumber(o.change ?? o.delta ?? o.amount ?? o.value);
    if (!resource || !n) {
      ctx.warnings.push(`Could not read change entry ${JSON.stringify(item).slice(0, 80)}`);
      continue;
    }
    const kind = String(o.type ?? o.unit ?? '').toLowerCase();
    if (n.percent || kind.includes('percent') || kind === '%') ctx.effects.push({ type: 'RESOURCE_PERCENT', resource, value: n.value });
    else if (kind === 'set' || kind === 'absolute') ctx.effects.push({ type: 'RESOURCE_SET', resource, value: Math.max(0, Math.round(n.value)) });
    else ctx.effects.push({ type: 'RESOURCE_DELTA', resource, value: Math.round(n.value) });
    ctx.understood.add(resource);
  }
}

const RES_WORDS = 'power|energy|solar|electricity|water|h2o|oxygen|o2|air|robot(?:ic)?s?|rovers?|drones?|bandwidth|comms|relay|uplink|telemetry';
const TEXT_PATTERN = new RegExp(
  `\\b(${RES_WORDS})\\b[^.;]{0,60}?\\b(drops?|decreases?|falls?|reduced?|reduces|loses?|lost|cut|increases?|rises?|gains?|grows?)\\b[^.;]{0,20}?\\bby\\s+(\\d+(?:\\.\\d+)?)\\s*(%|percent|units?)?`,
  'gi',
);
const HALVED_PATTERN = new RegExp(`\\b(${RES_WORDS})\\b[^.;]{0,40}?\\bhalved\\b`, 'gi');
const SIGNED_PATTERN = new RegExp(`\\b(${RES_WORDS})\\b(?:\\s+time)?\\s*[:=]?\\s*([+-])\\s*(\\d+(?:\\.\\d+)?)\\s*(%|percent)?`, 'gi');
const RESERVE_PATTERNS = [
  new RegExp(`(\\d+)\\s+(?:units?\\s+of\\s+)?(${RES_WORDS})(?:\\s+units?)?\\s+(?:to\\s+be\\s+)?(?:held|kept|set\\s+aside)?\\s*in\\s+reserve`, 'gi'),
  new RegExp(`\\b(?:hold|keep|reserve)\\s+(\\d+)\\s+(?:units?\\s+of\\s+)?(${RES_WORDS})`, 'gi'),
];
const RISK_PATTERN = /\brisk\b[^.;]{0,50}?\b(?:not\s+exceed|no\s+(?:more|higher)\s+than|at\s+most|below|capped\s+at|cap\s+of|limit(?:ed)?\s+to|under)\s+(\d+)/gi;
const GAIN_PATTERN = new RegExp(`(\\d+(?:\\.\\d+)?)\\s+(?:units?\\s+of\\s+)?(${RES_WORDS})\\b`, 'gi');
const GAIN_CONTEXT = /\b(deliver\w*|arriv\w*|receiv\w*|resuppl\w*|restor\w*|adds?|added|brings?|brought|gains?|donat\w*|supplies|supplied)\b/i;
const LOSS_CONTEXT = /\b(lose|loses|lost|destroy\w*|burn\w*|leak\w*|vent\w*|drain\w*|burst|damag\w*|spoil\w*)\b/i;
const CANNOT = /\b(?:cannot|can\s?not|can't|unable\s+to|may\s+not|must\s+not|no\s+longer\s+able\s+to|not\s+able\s+to)\b/i;
const DEPT_ALIASES: [DepartmentId, RegExp][] = [
  ['LIFE_SUPPORT', /\b(?:life\s*support|haven)\b/i],
  ['MEDICAL', /\b(?:medical|meridian)\b/i],
  ['FOOD', /\b(?:food(?:\s+production)?|verdant)\b/i],
  ['ENGINEERING', /\b(?:engineering|forge)\b/i],
];
const TIER_WORDS: [ModeTier, RegExp][] = [
  ['STANDARD', /\bstandard\b/i],
  ['RESTRICTED', /\brestricted\b/i],
  ['SACRIFICE', /\bsacrifice\b/i],
];

function blank(text: string, m: RegExpMatchArray): string {
  const at = m.index ?? 0;
  return text.slice(0, at) + ' '.repeat(m[0].length) + text.slice(at + m[0].length);
}

function readText(raw: string, ctx: ParseCtx, fromDescription: boolean): void {
  let text = raw.replace(/[−–]/g, '-');
  const note = (resource: ResourceKey) => {
    if (fromDescription) ctx.warnings.push(`${RESOURCE_LABEL[resource].name} change read from the description text`);
  };

  // Mission Control mandates first, so their numbers are not mistaken for resource changes.
  for (const pattern of RESERVE_PATTERNS) {
    for (const m of [...text.matchAll(pattern)]) {
      const resource = resourceIn(tokens(m[2]!));
      if (!resource) continue;
      ctx.effects.push({ type: 'RESERVE_REQUIREMENT', resource, value: Math.round(Number(m[1])) });
      text = blank(text, m);
    }
  }
  for (const m of [...text.matchAll(RISK_PATTERN)]) {
    ctx.effects.push({ type: 'RISK_LIMIT', value: Math.round(Number(m[1])) });
    text = blank(text, m);
  }
  for (const clause of text.split(/[.;]|,\s+and\s/)) {
    const cannot = CANNOT.exec(clause);
    if (!cannot) continue;
    const before = clause.slice(0, cannot.index);
    const after = clause.slice(cannot.index);
    const dept = DEPT_ALIASES.find(([, re]) => re.test(before))?.[0];
    const tier = TIER_WORDS.find(([, re]) => re.test(after))?.[0];
    if (dept && tier) ctx.effects.push({ type: 'FORBID_MODE', modeId: modeOf(dept, tier), reason: `"${clause.trim().slice(0, 120)}"` });
  }

  for (const m of [...text.matchAll(TEXT_PATTERN)]) {
    const resource = resourceIn(tokens(m[1]!));
    if (!resource || ctx.understood.has(resource)) continue;
    const magnitude = Number(m[3]);
    const negative = /drop|decreas|fall|reduc|lose|lost|cut/i.test(m[2]!);
    const value = negative ? -magnitude : magnitude;
    if (m[4] && /%|percent/i.test(m[4])) ctx.effects.push({ type: 'RESOURCE_PERCENT', resource, value });
    else ctx.effects.push({ type: 'RESOURCE_DELTA', resource, value: Math.round(value) });
    ctx.understood.add(resource);
    note(resource);
    text = blank(text, m);
  }
  for (const m of [...text.matchAll(HALVED_PATTERN)]) {
    const resource = resourceIn(tokens(m[1]!));
    if (!resource || ctx.understood.has(resource)) continue;
    ctx.effects.push({ type: 'RESOURCE_PERCENT', resource, value: -50 });
    ctx.understood.add(resource);
    text = blank(text, m);
  }
  for (const m of [...text.matchAll(SIGNED_PATTERN)]) {
    const resource = resourceIn(tokens(m[1]!));
    if (!resource || ctx.understood.has(resource)) continue;
    const value = (m[2] === '-' ? -1 : 1) * Number(m[3]);
    if (m[4]) ctx.effects.push({ type: 'RESOURCE_PERCENT', resource, value });
    else ctx.effects.push({ type: 'RESOURCE_DELTA', resource, value: Math.round(value) });
    ctx.understood.add(resource);
    note(resource);
    text = blank(text, m);
  }
  // "delivers 8 power cells and 5 units of water": only when the sentence says supply arrived (or was lost).
  for (const sentence of text.split(/[.;]/)) {
    const gain = GAIN_CONTEXT.test(sentence);
    const loss = !gain && LOSS_CONTEXT.test(sentence);
    if (!gain && !loss) continue;
    for (const m of sentence.matchAll(GAIN_PATTERN)) {
      const resource = resourceIn(tokens(m[2]!));
      if (!resource || ctx.understood.has(resource)) continue;
      const value = Math.round(Number(m[1]));
      ctx.effects.push({ type: 'RESOURCE_DELTA', resource, value: loss ? -value : value });
      ctx.understood.add(resource);
      note(resource);
    }
  }
}

function triggerHourOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const m = value.match(/(\d+(?:\.\d+)?)/);
    if (m) return Number(m[1]);
  }
  return null;
}

export interface ParseOptions {
  source?: EventSource;
}

/** Parse the official JSON format, any other JSON object, or a plain-text description. */
export function parseEventInput(input: unknown, options: ParseOptions = {}): EventInterpretation {
  const ctx: ParseCtx = { effects: [], warnings: [], assumptions: [], understood: new Set() };
  const source: EventSource = options.source ?? 'DETERMINISTIC';

  if (typeof input === 'string') {
    const text = input.trim();
    readText(text, ctx, false);
    if (ctx.effects.length === 0) ctx.warnings.push('No quantitative resource change recognized in the text');
    const firstSentence = text.split(/(?<=[.!?])\s/)[0] ?? text;
    return {
      title: firstSentence.slice(0, 80) || 'Judge-described event',
      summary: text,
      effects: ctx.effects,
      durationHours: null,
      triggerHour: null,
      requiresReplan: true,
      messageToCommander: null,
      source,
      confidence: ctx.effects.length ? 0.7 : 0.3,
      warnings: ctx.warnings,
      assumptions: ctx.assumptions,
      raw: input,
    };
  }

  const obj = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const impact = obj.impact && typeof obj.impact === 'object' && !Array.isArray(obj.impact) ? (obj.impact as Record<string, unknown>) : {};
  const unread: string[] = [];

  if (Array.isArray(input)) readChangeArray(input, ctx);
  const walk = (scope: Record<string, unknown>, prefix: string[], depth: number): void => {
    for (const [key, value] of Object.entries(scope)) {
      const lower = key.toLowerCase();
      if (Array.isArray(value) && value.some((v) => v && typeof v === 'object')) {
        readChangeArray(value, ctx);
        continue;
      }
      if (value && typeof value === 'object' && !Array.isArray(value) && depth < 4) {
        walk(value as Record<string, unknown>, GENERIC_KEYS.has(lower) ? prefix : [...prefix, key], depth + 1);
        continue;
      }
      const joined = [...prefix, key].join('_');
      if (!readEntry(joined, value, ctx, key) && !ctx.warnings.some((w) => w.includes(`"${joined}"`))) unread.push(joined);
    }
  };
  walk(obj, [], 0);
  for (const key of unread) ctx.warnings.push(`Unrecognized key "${key}"; not applied`);

  const description = typeof obj.description === 'string' ? obj.description : '';
  if (description) readText(description, ctx, true);

  const affected = impact.affected_systems ?? obj.affected_systems;
  if (Array.isArray(affected) && affected.length) ctx.effects.push({ type: 'INFO', note: `Affected systems: ${affected.join(', ')}` });

  const durationRaw = impact.duration_hours ?? obj.duration_hours;
  const duration = parseNumber(durationRaw);
  const title = String(obj.event_name ?? obj.name ?? obj.title ?? 'Unnamed event');
  const requiresReplan = typeof obj.requires_replan === 'boolean' ? obj.requires_replan : true;
  const resourceEffects = ctx.effects.filter((e) => e.type.startsWith('RESOURCE_') || e.type === 'RESERVE_REQUIREMENT');
  if (resourceEffects.length === 0 && !ctx.effects.some((e) => e.type === 'RISK_LIMIT' || e.type === 'MAX_SACRIFICES' || e.type === 'FORBID_MODE')) {
    ctx.warnings.push('No resource or policy effect recognized');
  }
  return {
    title,
    summary: description || title,
    effects: ctx.effects,
    durationHours: duration ? duration.value : null,
    triggerHour: triggerHourOf(obj.trigger_time),
    requiresReplan,
    messageToCommander: typeof obj.message_to_commander === 'string' ? obj.message_to_commander : null,
    source,
    confidence: ctx.warnings.length === 0 ? 1 : Math.max(0.4, 1 - 0.15 * ctx.warnings.length),
    warnings: ctx.warnings,
    assumptions: ctx.assumptions,
    raw: input,
  };
}

export interface EffectBase {
  pool: ResourceVector;
  reserveRequirements: Partial<ResourceVector>;
  forbiddenModes: readonly ModeId[];
  riskCap: number | null;
  maxSacrificesCap: number | null;
  priorities: readonly string[];
}

export interface EffectResult {
  pool: ResourceVector;
  reserveRequirements: Partial<ResourceVector>;
  forbiddenModes: ModeId[];
  riskCap: number | null;
  maxSacrificesCap: number | null;
  priorities: string[];
  notes: string[];
}

const clampPool = (v: number) => Math.min(999, Math.max(0, v));

/** Percent changes round DOWN in both directions (conservative: never overstates supply). */
export function applyPercent(value: number, percent: number): number {
  const exact = value * (1 + percent / 100);
  return clampPool(Math.floor(Math.round(exact * 1e6) / 1e6));
}

export function applyEffects(base: EffectBase, effects: readonly EventEffect[]): EffectResult {
  const pool = { ...base.pool };
  const reserveRequirements = { ...base.reserveRequirements };
  const forbidden = new Set(base.forbiddenModes);
  let riskCap = base.riskCap;
  let maxSacrificesCap = base.maxSacrificesCap;
  const priorities = [...base.priorities];
  const notes: string[] = [];
  for (const e of effects) {
    switch (e.type) {
      case 'RESOURCE_DELTA':
        pool[e.resource] = clampPool(pool[e.resource] + e.value);
        break;
      case 'RESOURCE_PERCENT':
        pool[e.resource] = applyPercent(pool[e.resource], e.value);
        break;
      case 'RESOURCE_SET':
        pool[e.resource] = clampPool(Math.round(e.value));
        break;
      case 'RESERVE_REQUIREMENT':
        reserveRequirements[e.resource] = Math.max(0, Math.round(e.value));
        break;
      case 'FORBID_MODE':
        forbidden.add(e.modeId);
        break;
      case 'ALLOW_MODE':
        forbidden.delete(e.modeId);
        break;
      case 'RISK_LIMIT':
        riskCap = e.value;
        break;
      case 'MAX_SACRIFICES':
        maxSacrificesCap = e.value;
        break;
      case 'PRIORITY':
        priorities.push(e.department ? `${DEPARTMENT_LABEL[e.department]}: ${e.note}` : e.note);
        break;
      case 'INFO':
        notes.push(e.note);
        break;
    }
  }
  return { pool, reserveRequirements, forbiddenModes: [...forbidden], riskCap, maxSacrificesCap, priorities, notes };
}

/** Human-readable description of one effect, with the arithmetic when the pool is known. */
export function describeEffect(e: EventEffect, pool?: ResourceVector): string {
  switch (e.type) {
    case 'RESOURCE_DELTA':
      return `${RESOURCE_LABEL[e.resource].name} ${e.value >= 0 ? '+' : ''}${e.value}${pool ? ` (${pool[e.resource]} → ${clampPool(pool[e.resource] + e.value)})` : ''}`;
    case 'RESOURCE_PERCENT':
      return `${RESOURCE_LABEL[e.resource].name} ${e.value >= 0 ? '+' : ''}${e.value}%${
        pool ? ` (${pool[e.resource]} × ${(1 + e.value / 100).toFixed(2)} → ${applyPercent(pool[e.resource], e.value)}, rounded down for safety)` : ''
      }`;
    case 'RESOURCE_SET':
      return `${RESOURCE_LABEL[e.resource].name} set to ${e.value}`;
    case 'RESERVE_REQUIREMENT':
      return `Keep ${e.value} ${RESOURCE_LABEL[e.resource].name} unallocated in reserve`;
    case 'FORBID_MODE':
      return `${e.modeId} unavailable (${e.reason})`;
    case 'ALLOW_MODE':
      return `${e.modeId} available again`;
    case 'RISK_LIMIT':
      return `Combined risk capped at ${e.value}`;
    case 'MAX_SACRIFICES':
      return `At most ${e.value} Sacrifice mode(s)`;
    case 'PRIORITY':
      return `Priority: ${e.department ? `${DEPARTMENT_LABEL[e.department]} — ` : ''}${e.note}`;
    case 'INFO':
      return e.note;
  }
}

export const RESOURCE_EFFECT_KEYS: readonly ResourceKey[] = RESOURCE_KEYS;
export type { DepartmentId };
