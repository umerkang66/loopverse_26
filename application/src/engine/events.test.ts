import { describe, expect, it } from 'vitest';
import { EVENT_PRESETS, SCENARIO } from '@/domain/scenario';
import { applyEffects, applyPercent, parseEventInput } from './events';
import { BASE_POOL } from './test-helpers';

const base = { pool: BASE_POOL, reserveRequirements: {}, forbiddenModes: [], riskCap: null, maxSacrificesCap: null, priorities: [] };

describe('event intake', () => {
  it('parses the official injection format', () => {
    const e = parseEventInput(SCENARIO.officialSampleEvent);
    expect(e.title).toBe('Solar Aftershock');
    expect(e.effects).toContainEqual({ type: 'RESOURCE_PERCENT', resource: 'power', value: -30 });
    expect(e.durationHours).toBe(6);
    expect(e.triggerHour).toBe(14);
    expect(e.requiresReplan).toBe(true);
    expect(e.messageToCommander).toContain('Council must reconvene');
    expect(e.warnings).toEqual([]);
    expect(e.confidence).toBe(1);
    expect(applyEffects(base, e.effects).pool.power).toBe(55);
  });

  it.each([
    ['PRACTICE_SOLAR', { power: 75 }],
    ['PRACTICE_WATER', { water: 49 }],
    ['PRACTICE_OXYGEN', { oxygen: 56 }],
    ['PRACTICE_ROVER', { robot: 22 }],
    ['PRACTICE_RELAY', { bandwidth: 15 }],
  ])('preset %s produces the expected pool', (id, expected) => {
    const preset = EVENT_PRESETS.find((p) => p.id === id)!;
    const e = parseEventInput(preset.payload, { source: 'PRESET' });
    expect(e.warnings).toEqual([]);
    expect(applyEffects(base, e.effects).pool).toEqual({ ...BASE_POOL, ...expected });
  });

  it('reads unseen mixed keys', () => {
    const e = parseEventInput({ event_name: 'Mixed', impact: { oxygen_loss_units: 5, bandwidth_reduction_percent: 50, risk_limit: 22 } });
    expect(e.effects).toEqual(
      expect.arrayContaining([
        { type: 'RESOURCE_DELTA', resource: 'oxygen', value: -5 },
        { type: 'RESOURCE_PERCENT', resource: 'bandwidth', value: -50 },
        { type: 'RISK_LIMIT', value: 22 },
      ]),
    );
    const out = applyEffects(base, e.effects);
    expect(out.pool.oxygen).toBe(54);
    expect(out.pool.bandwidth).toBe(8);
    expect(out.riskCap).toBe(22);
  });

  it('bare resource keys are signed deltas; "available" sets the value', () => {
    expect(parseEventInput({ impact: { water: -6 } }).effects).toEqual([{ type: 'RESOURCE_DELTA', resource: 'water', value: -6 }]);
    expect(parseEventInput({ impact: { robot_time_available: 18 } }).effects).toEqual([{ type: 'RESOURCE_SET', resource: 'robot', value: 18 }]);
  });

  it('never guesses magnitudes it cannot read', () => {
    const e = parseEventInput({
      event_name: 'Dust storm',
      impact: { solar_output_drop_pct: 25, relay_blackout_hours: 12, comms_blackout: true, food_capacity_percent: -40 },
    });
    expect(e.effects).toEqual([{ type: 'RESOURCE_PERCENT', resource: 'power', value: -25 }]);
    expect(e.warnings.join(' ')).toContain('relay_blackout_hours');
    expect(e.warnings.join(' ')).toContain('comms_blackout');
    expect(e.warnings.join(' ')).toContain('food_capacity_percent');
    expect(e.confidence).toBeLessThan(1);
    expect(applyEffects(base, e.effects).pool.power).toBe(59);
  });

  it('reads plain-text descriptions', () => {
    const e = parseEventInput('Cascade failure: power drops by 6 units and oxygen falls by 2.');
    expect(e.effects).toEqual([
      { type: 'RESOURCE_DELTA', resource: 'power', value: -6 },
      { type: 'RESOURCE_DELTA', resource: 'oxygen', value: -2 },
    ]);
    expect(parseEventInput('Relay satellite lost — bandwidth halved.').effects).toEqual([{ type: 'RESOURCE_PERCENT', resource: 'bandwidth', value: -50 }]);
  });

  it('applies policy effects and rounds percent changes down', () => {
    expect(applyPercent(79, -30)).toBe(55);
    expect(applyPercent(17, -50)).toBe(8);
    expect(applyPercent(79, -25)).toBe(59);
    const out = applyEffects(base, [
      { type: 'FORBID_MODE', modeId: 'M3', reason: 'r' },
      { type: 'RESERVE_REQUIREMENT', resource: 'oxygen', value: 3 },
      { type: 'MAX_SACRIFICES', value: 0 },
    ]);
    expect(out.forbiddenModes).toEqual(['M3']);
    expect(out.reserveRequirements).toEqual({ oxygen: 3 });
    expect(out.maxSacrificesCap).toBe(0);
  });
});
