import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { feasiblePlans } from '@/engine/optimizer';
import { applyEffects, parseEventInput } from '@/engine/events';
import { basePolicy, overridePolicy } from '@/engine/policy';
import { BASE_POOL } from '@/engine/test-helpers';
import type { EventEffect } from '@/domain/types';

const base = { pool: BASE_POOL, reserveRequirements: {}, forbiddenModes: [], riskCap: null, maxSacrificesCap: null, priorities: [] };
const fixture = (name: string) => readFileSync(new URL(`./fixtures/unseen-events/${name}`, import.meta.url), 'utf8');
const json = (name: string) => JSON.parse(fixture(name)) as unknown;

function outcome(effects: EventEffect[]) {
  const r = applyEffects(base, effects);
  const c = { pool: r.pool, reserveRequirements: r.reserveRequirements, forbiddenModes: r.forbiddenModes, riskCap: r.riskCap, maxSacrificesCap: r.maxSacrificesCap };
  return { pool: r.pool, baseline: feasiblePlans(c, basePolicy()).length, override: feasiblePlans(c, overridePolicy()).length };
}

describe('unseen events — deterministic parser (U-suite)', () => {
  it('U1 dust storm: power −25 %, relay hours become INFO + assumption', () => {
    const e = parseEventInput(json('U1.json'));
    expect(e.effects).toContainEqual({ type: 'RESOURCE_PERCENT', resource: 'power', value: -25 });
    expect(e.effects.some((x) => x.type === 'INFO' && x.note.includes('relay_blackout_hours'))).toBe(true);
    expect(e.effects.filter((x) => x.type.startsWith('RESOURCE_'))).toHaveLength(1);
    expect(e.assumptions.join(' ')).toContain('relay_blackout_hours');
    const o = outcome(e.effects);
    expect(o.pool.power).toBe(59);
    expect(o.baseline + o.override).toBe(0);
  });

  it('U2 pump burst: water −6 is infeasible', () => {
    const o = outcome(parseEventInput(json('U2.json')).effects);
    expect(o.pool.water).toBe(46);
    expect(o.baseline + o.override).toBe(0);
  });

  it('U3 hand-written effects: nothing at baseline, exactly one plan under override', () => {
    const o = outcome([
      { type: 'FORBID_MODE', modeId: 'M3', reason: 'x' },
      { type: 'RESERVE_REQUIREMENT', resource: 'oxygen', value: 3 },
    ]);
    expect(o.baseline).toBe(0);
    expect(o.override).toBe(1);
  });

  it('U3 prose parses deterministically too', () => {
    const e = parseEventInput(fixture('U3.txt'));
    expect(e.effects).toContainEqual({ type: 'FORBID_MODE', modeId: 'M3', reason: expect.any(String) });
    expect(e.effects).toContainEqual({ type: 'RESERVE_REQUIREMENT', resource: 'oxygen', value: 3 });
  });

  it('U4 resupply keeps baseline plans feasible', () => {
    const e = parseEventInput(fixture('U4.txt'));
    expect(e.effects).toEqual([
      { type: 'RESOURCE_DELTA', resource: 'power', value: 8 },
      { type: 'RESOURCE_DELTA', resource: 'water', value: 5 },
    ]);
    expect(outcome(e.effects).baseline).toBeGreaterThan(0);
  });

  it('U5 robot set to 18 is infeasible', () => {
    const e = parseEventInput(json('U5.json'));
    expect(e.effects).toEqual([{ type: 'RESOURCE_SET', resource: 'robot', value: 18 }]);
    expect(outcome(e.effects).override).toBe(0);
  });

  it('U6 risk cap 22 is infeasible', () => {
    const e = parseEventInput(fixture('U6.txt'));
    expect(e.effects).toEqual([{ type: 'RISK_LIMIT', value: 22 }]);
    const o = outcome(e.effects);
    expect(o.baseline + o.override).toBe(0);
  });

  it('U7 bandwidth halved', () => {
    expect(outcome(parseEventInput(fixture('U7.txt')).effects).pool.bandwidth).toBe(8);
  });

  it('U8 forbids exactly E1', () => {
    const e = parseEventInput(fixture('U8.txt'));
    expect(e.effects.filter((x) => x.type === 'FORBID_MODE')).toEqual([{ type: 'FORBID_MODE', modeId: 'E1', reason: expect.any(String) }]);
  });

  it('U9 cascade: three deltas, infeasible', () => {
    const e = parseEventInput(fixture('U9.txt'));
    expect(e.effects).toEqual([
      { type: 'RESOURCE_DELTA', resource: 'power', value: -6 },
      { type: 'RESOURCE_DELTA', resource: 'oxygen', value: -2 },
      { type: 'RESOURCE_DELTA', resource: 'robot', value: -3 },
    ]);
    const o = outcome(e.effects);
    expect(o.baseline + o.override).toBe(0);
  });

  it('U10 greenhouse fire: oxygen −2, food capacity becomes PRIORITY FOOD + INFO', () => {
    const e = parseEventInput(json('U10.json'));
    expect(e.effects).toContainEqual({ type: 'RESOURCE_DELTA', resource: 'oxygen', value: -2 });
    expect(e.effects.some((x) => x.type === 'PRIORITY' && x.department === 'FOOD')).toBe(true);
    expect(e.effects.some((x) => x.type === 'INFO')).toBe(true);
    const o = outcome(e.effects);
    expect(o.pool.oxygen).toBe(57);
    expect(o.baseline).toBe(1);
  });

  it('U11 official sample: power 55, infeasible', () => {
    const e = parseEventInput(json('U11.json'));
    const o = outcome(e.effects);
    expect(o.pool.power).toBe(55);
    expect(e.durationHours).toBe(6);
    expect(e.triggerHour).toBe(14);
    expect(o.baseline + o.override).toBe(0);
  });

  it('hardening: nested objects, change arrays, unit strings, trigger formats', () => {
    expect(parseEventInput({ impact: { resources: { power: { delta: -4 } } } }).effects).toContainEqual({ type: 'RESOURCE_DELTA', resource: 'power', value: -4 });
    expect(parseEventInput({ changes: [{ resource: 'oxygen', change: -3 }] }).effects).toEqual([{ type: 'RESOURCE_DELTA', resource: 'oxygen', value: -3 }]);
    expect(parseEventInput([{ type: 'percent', target: 'power', amount: -25 }]).effects).toEqual([{ type: 'RESOURCE_PERCENT', resource: 'power', value: -25 }]);
    expect(parseEventInput({ impact: { power: '-30%' } }).effects).toEqual([{ type: 'RESOURCE_PERCENT', resource: 'power', value: -30 }]);
    expect(parseEventInput({ impact: { water: '-4 units' } }).effects).toEqual([{ type: 'RESOURCE_DELTA', resource: 'water', value: -4 }]);
    for (const t of ['Hour 14', 'T+14h', '14:00', 14]) expect(parseEventInput({ trigger_time: t, impact: { water: -1 } }).triggerHour).toBe(14);
  });
});
