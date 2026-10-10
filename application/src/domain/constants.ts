import type { DepartmentId, ModeId, ResourceKey } from './types';

export const DEPT_MODES = {
  LIFE_SUPPORT: ['L1', 'L2', 'L3'],
  MEDICAL: ['M1', 'M2', 'M3'],
  FOOD: ['F1', 'F2', 'F3'],
  ENGINEERING: ['E1', 'E2', 'E3'],
} as const satisfies Record<DepartmentId, readonly [ModeId, ModeId, ModeId]>;

export const SACRIFICE_MODES = ['L3', 'M3', 'F3', 'E3'] as const satisfies readonly ModeId[];

export const RESOURCE_LABEL: Record<ResourceKey, { short: string; name: string }> = {
  power: { short: 'P', name: 'Power' },
  water: { short: 'W', name: 'Water' },
  oxygen: { short: 'O', name: 'Oxygen' },
  robot: { short: 'R', name: 'Robot time' },
  bandwidth: { short: 'B', name: 'Bandwidth' },
};

export const DEPARTMENT_LABEL: Record<DepartmentId, string> = {
  LIFE_SUPPORT: 'Life Support',
  MEDICAL: 'Medical',
  FOOD: 'Food Production',
  ENGINEERING: 'Engineering',
};

/** Official output_schema.json agent ids (see export/output-schema). */
export const OFFICER_ID: Record<DepartmentId, string> = {
  LIFE_SUPPORT: 'LIFE_SUPPORT_OFFICER',
  MEDICAL: 'MEDICAL_OFFICER',
  FOOD: 'FOOD_PRODUCTION_OFFICER',
  ENGINEERING: 'ENGINEERING_OFFICER',
};
