// Loads the scenario DATA (ares-accord.json), validates it with zod, and deep-freezes it.
// Nothing about the crisis is hardcoded in logic: pool, packages, policy and presets all live in the JSON.
import { z } from 'zod';
import raw from './ares-accord.json';
import {
  AGENT_IDS,
  DEPARTMENT_IDS,
  MODE_IDS,
  RESOURCE_KEYS,
  type AgentId,
  type AgentProfile,
  type CommitmentKind,
  type DepartmentId,
  type Expiry,
  type ModeId,
  type ModePackage,
  type ResourceKey,
  type ResourceVector,
} from '../types';

const ResourceVectorSchema = z.object({
  power: z.number().int().nonnegative(),
  water: z.number().int().nonnegative(),
  oxygen: z.number().int().nonnegative(),
  robot: z.number().int().nonnegative(),
  bandwidth: z.number().int().nonnegative(),
});

const ExpirySchema = z.object({
  unit: z.enum(['HOURS', 'CYCLES', 'SCENARIOS']),
  value: z.number().int().positive(),
  label: z.string(),
});

const ReferenceReturnSchema = z.object({
  owner: z.enum(AGENT_IDS),
  kind: z.enum(['RESOURCE_SHARE', 'RESERVE_ASSIGNMENT', 'PRIORITY', 'FUTURE_RESOURCE', 'OTHER']),
  resource: z.enum(RESOURCE_KEYS).nullable(),
  amount: z.number().int().positive().nullable(),
  promise: z.string(),
  expiry: ExpirySchema,
});

const ScenarioConfigSchema = z.object({
  id: z.string(),
  title: z.string(),
  narrative: z.string(),
  colony: z.object({ crew: z.number().int(), injured: z.number().int() }),
  initialPool: ResourceVectorSchema,
  policy: z.object({
    baseRiskLimit: z.number().int(),
    baseMaxSacrifices: z.number().int(),
    requiredReturnCommitments: z.number().int(),
    crisisOverride: z.object({
      riskLimit: z.number().int(),
      maxSacrifices: z.number().int(),
      onlyAfterEvent: z.boolean(),
      onlyWhenBaselineInfeasible: z.boolean(),
    }),
    minRoundsBeforeFirstApproval: z.number().int(),
    minRoundsAfterEvent: z.number().int(),
    defaultEventHourStep: z.number().int(),
  }),
  modes: z
    .array(
      z.object({
        id: z.enum(MODE_IDS),
        department: z.enum(DEPARTMENT_IDS),
        tier: z.enum(['STANDARD', 'RESTRICTED', 'SACRIFICE']),
        label: z.string(),
        resources: ResourceVectorSchema,
        risk: z.number().int(),
        consequence: z.string(),
      }),
    )
    .length(12),
  compensationGuide: z.record(
    z.string(),
    z.object({ lost: z.string(), referenceReturns: z.array(ReferenceReturnSchema) }),
  ),
  agents: z
    .array(
      z.object({
        id: z.enum(AGENT_IDS),
        callsign: z.string(),
        name: z.string(),
        title: z.string(),
        departmentName: z.string(),
        mission: z.string(),
        mainConcern: z.string(),
        goals: z.array(z.string()),
        constraints: z.array(z.string()),
        redLines: z.array(z.string()),
        voice: z.string(),
        color: z.string(),
      }),
    )
    .length(5),
  practiceEvents: z.array(z.record(z.string(), z.unknown())),
  officialSampleEvent: z.record(z.string(), z.unknown()),
});

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

export interface ReferenceReturn {
  owner: AgentId;
  kind: CommitmentKind;
  resource: ResourceKey | null;
  amount: number | null;
  promise: string;
  expiry: Expiry;
}

const parsed = ScenarioConfigSchema.parse(raw);

// Integrity: every department must have exactly one package per tier.
for (const dept of DEPARTMENT_IDS) {
  const tiers = parsed.modes.filter((m) => m.department === dept).map((m) => m.tier).sort();
  if (tiers.join(',') !== 'RESTRICTED,SACRIFICE,STANDARD') {
    throw new Error(`Scenario data invalid: ${dept} must have exactly one Standard, Restricted and Sacrifice package`);
  }
}

export const SCENARIO = deepFreeze(parsed);
export type ScenarioConfig = typeof SCENARIO;

export const MODES: readonly ModePackage[] = SCENARIO.modes as readonly ModePackage[];

const MODE_BY_ID = new Map<ModeId, ModePackage>(MODES.map((m) => [m.id, m]));

export function getMode(id: ModeId): ModePackage {
  const mode = MODE_BY_ID.get(id);
  if (!mode) throw new Error(`Unknown mode ${id}`);
  return mode;
}

export function isModeId(value: unknown): value is ModeId {
  return typeof value === 'string' && MODE_BY_ID.has(value as ModeId);
}

export function modesFor(dept: DepartmentId): ModePackage[] {
  return MODES.filter((m) => m.department === dept);
}

export const PROFILES: Readonly<Record<AgentId, AgentProfile>> = deepFreeze(
  Object.fromEntries(SCENARIO.agents.map((a) => [a.id, a])) as Record<AgentId, AgentProfile>,
);

export function referenceReturnsFor(sacrificeMode: ModeId): ReferenceReturn[] {
  return (SCENARIO.compensationGuide[sacrificeMode]?.referenceReturns ?? []) as ReferenceReturn[];
}

export function lossOf(sacrificeMode: ModeId): string | null {
  return SCENARIO.compensationGuide[sacrificeMode]?.lost ?? null;
}

export const INITIAL_POOL: ResourceVector = SCENARIO.initialPool;

export interface EventPreset {
  id: string;
  name: string;
  description: string;
  payload: Record<string, unknown>;
}

export const EVENT_PRESETS: readonly EventPreset[] = [
  ...SCENARIO.practiceEvents.map((e) => ({
    id: String(e.event_id),
    name: String(e.event_name),
    description: String(e.description ?? ''),
    payload: e as Record<string, unknown>,
  })),
  {
    id: 'OFFICIAL_SAMPLE',
    name: `${String(SCENARIO.officialSampleEvent.event_name)} (official sample, −30% power)`,
    description: String(SCENARIO.officialSampleEvent.description ?? ''),
    payload: SCENARIO.officialSampleEvent as Record<string, unknown>,
  },
];
