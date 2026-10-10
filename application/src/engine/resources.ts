import { RESOURCE_LABEL } from '@/domain/constants';
import { RESOURCE_KEYS, type ResourceKey, type ResourceVector } from '@/domain/types';

export const ZERO: Readonly<ResourceVector> = Object.freeze({ power: 0, water: 0, oxygen: 0, robot: 0, bandwidth: 0 });

export function vec(partial: Partial<ResourceVector> = {}): ResourceVector {
  return {
    power: partial.power ?? 0,
    water: partial.water ?? 0,
    oxygen: partial.oxygen ?? 0,
    robot: partial.robot ?? 0,
    bandwidth: partial.bandwidth ?? 0,
  };
}

export function map(v: ResourceVector, fn: (value: number, key: ResourceKey) => number): ResourceVector {
  return {
    power: fn(v.power, 'power'),
    water: fn(v.water, 'water'),
    oxygen: fn(v.oxygen, 'oxygen'),
    robot: fn(v.robot, 'robot'),
    bandwidth: fn(v.bandwidth, 'bandwidth'),
  };
}

export function add(a: ResourceVector, b: ResourceVector): ResourceVector {
  return map(a, (value, key) => value + b[key]);
}

export function sub(a: ResourceVector, b: ResourceVector): ResourceVector {
  return map(a, (value, key) => value - b[key]);
}

export function sum(vectors: readonly ResourceVector[]): ResourceVector {
  return vectors.reduce<ResourceVector>((acc, v) => add(acc, v), vec());
}

/** Capacity available for allocation: pool minus units that events require to stay in reserve. */
export function capOf(pool: ResourceVector, reserveRequirements: Partial<ResourceVector> = {}): ResourceVector {
  return map(pool, (value, key) => value - (reserveRequirements[key] ?? 0));
}

/** Positive overages only (how far demand exceeds the cap). */
export function over(demand: ResourceVector, cap: ResourceVector): ResourceVector {
  return map(demand, (value, key) => Math.max(0, value - cap[key]));
}

export function fits(demand: ResourceVector, cap: ResourceVector): boolean {
  return RESOURCE_KEYS.every((key) => demand[key] <= cap[key]);
}

export function total(v: ResourceVector): number {
  return RESOURCE_KEYS.reduce((acc, key) => acc + v[key], 0);
}

export function countPositive(v: ResourceVector): number {
  return RESOURCE_KEYS.filter((key) => v[key] > 0).length;
}

export function equal(a: ResourceVector, b: ResourceVector): boolean {
  return RESOURCE_KEYS.every((key) => a[key] === b[key]);
}

/** "P79 W50 O57 R26 B17" */
export function fmt(v: ResourceVector): string {
  return RESOURCE_KEYS.map((key) => `${RESOURCE_LABEL[key].short}${v[key]}`).join(' ');
}

/** "P79/79 W50/52 O57/59 R26/26 B17/17" */
export function fmtVs(totals: ResourceVector, pool: ResourceVector): string {
  return RESOURCE_KEYS.map((key) => `${RESOURCE_LABEL[key].short}${totals[key]}/${pool[key]}`).join(' ');
}

/** Signed non-zero deltas: "P-4 W-1 R-4". */
export function fmtDelta(v: ResourceVector): string {
  const parts = RESOURCE_KEYS.filter((key) => v[key] !== 0).map(
    (key) => `${RESOURCE_LABEL[key].short}${v[key] > 0 ? '+' : ''}${v[key]}`,
  );
  return parts.length ? parts.join(' ') : 'no change';
}

/** Positive shortfalls in words: "Power +19, Robot time +2". */
export function fmtShortfall(v: ResourceVector): string {
  const parts = RESOURCE_KEYS.filter((key) => v[key] > 0).map((key) => `${RESOURCE_LABEL[key].name} +${v[key]}`);
  return parts.length ? parts.join(', ') : 'none';
}

/** Overages in words with the comparison: "Power 83 > 79 (+4) · Oxygen 60 > 59 (+1)". */
export function fmtOverages(totals: ResourceVector, cap: ResourceVector): string {
  return RESOURCE_KEYS.filter((key) => totals[key] > cap[key])
    .map((key) => `${RESOURCE_LABEL[key].name} ${totals[key]} > ${cap[key]} (+${totals[key] - cap[key]})`)
    .join(' · ');
}

export function isValidPool(v: unknown): v is ResourceVector {
  if (!v || typeof v !== 'object') return false;
  return RESOURCE_KEYS.every((key) => {
    const value = (v as Record<string, unknown>)[key];
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 999;
  });
}
