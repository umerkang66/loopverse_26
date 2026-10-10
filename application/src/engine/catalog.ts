import { DEPT_MODES } from '@/domain/constants';
import { getMode, MODES } from '@/domain/scenario';
import {
  DEPARTMENT_IDS,
  type DepartmentId,
  type ModeId,
  type ModePackage,
  type ModeTier,
  type ResourceVector,
  type Selections,
} from '@/domain/types';
import { add, vec } from './resources';

export function packageOf(id: ModeId): ModePackage {
  return getMode(id);
}

export function tierOf(id: ModeId): ModeTier {
  return getMode(id).tier;
}

export function deptOfMode(id: ModeId): DepartmentId {
  return getMode(id).department;
}

export function modeOf(dept: DepartmentId, tier: ModeTier): ModeId {
  const mode = MODES.find((m) => m.department === dept && m.tier === tier);
  if (!mode) throw new Error(`No ${tier} mode for ${dept}`);
  return mode.id;
}

export function sacrificeModeOf(dept: DepartmentId): ModeId {
  return modeOf(dept, 'SACRIFICE');
}

export function standardModeOf(dept: DepartmentId): ModeId {
  return modeOf(dept, 'STANDARD');
}

export function restrictedModeOf(dept: DepartmentId): ModeId {
  return modeOf(dept, 'RESTRICTED');
}

export const TIER_RANK: Record<ModeTier, number> = { STANDARD: 3, RESTRICTED: 2, SACRIFICE: 1 };

export interface SelectionTotals {
  totals: ResourceVector;
  risk: number;
  sacrifices: DepartmentId[];
}

export function selectionTotals(selections: Selections): SelectionTotals {
  let totals = vec();
  let risk = 0;
  const sacrifices: DepartmentId[] = [];
  for (const dept of DEPARTMENT_IDS) {
    const pkg = getMode(selections[dept]);
    totals = add(totals, pkg.resources);
    risk += pkg.risk;
    if (pkg.tier === 'SACRIFICE') sacrifices.push(dept);
  }
  return { totals, risk, sacrifices };
}

/** "L3+M2+F2+E2" */
export function selectionKey(selections: Selections): string {
  return DEPARTMENT_IDS.map((dept) => selections[dept]).join('+');
}

export function selectionsEqual(a: Selections, b: Selections): boolean {
  return DEPARTMENT_IDS.every((dept) => a[dept] === b[dept]);
}

/** All 81 complete combinations in a stable order (L1..L3 × M1..M3 × F1..F3 × E1..E3). */
export const ALL_SELECTIONS: readonly Selections[] = Object.freeze(
  DEPT_MODES.LIFE_SUPPORT.flatMap((LIFE_SUPPORT) =>
    DEPT_MODES.MEDICAL.flatMap((MEDICAL) =>
      DEPT_MODES.FOOD.flatMap((FOOD) =>
        DEPT_MODES.ENGINEERING.map((ENGINEERING) => Object.freeze({ LIFE_SUPPORT, MEDICAL, FOOD, ENGINEERING })),
      ),
    ),
  ),
);

/** A deterministic fingerprint of the published packages (FNV-1a over canonical JSON). */
export function catalogFingerprint(modes: readonly ModePackage[] = MODES): string {
  const canonical = JSON.stringify(
    [...modes]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((m) => [m.id, m.department, m.tier, m.resources.power, m.resources.water, m.resources.oxygen, m.resources.robot, m.resources.bandwidth, m.risk]),
  );
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export const PUBLISHED_FINGERPRINT = catalogFingerprint();
