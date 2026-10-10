import 'server-only';
import { z } from 'zod';
import { OFFICER_ID } from '@/domain/constants';
import { getMode } from '@/domain/scenario';
import type { DepartmentId, ModeId, VoteDecision } from '@/domain/types';

/**
 * The repo's output_schema.json predates the PDF's five-resource model, so every proposal and vote also carries a
 * derived, schema-compatible record (original keys kept; robot time, bandwidth and mode added as extensions).
 */
export const OutputSchemaRecord = z.object({
  round: z.number().int(),
  agent_id: z.string(),
  proposal: z.object({
    mode_id: z.string(),
    mode_tier: z.string(),
    oxygen_units: z.number(),
    water_liters: z.number(),
    power_kwh: z.number(),
    robot_time_units: z.number(),
    bandwidth_units: z.number(),
    food_rations: z.null(),
    justification: z.string(),
  }),
  vote: z.enum(['APPROVE', 'REJECT']).nullable(),
  plan_version: z.number().int().nullable(),
  risk_score: z.number().int(),
  plan_total_risk: z.number().int().nullable(),
  flag_human_review: z.boolean(),
});
export type OutputSchemaRecord = z.infer<typeof OutputSchemaRecord>;

export function toOutputSchemaRecord(input: {
  round: number;
  dept: DepartmentId;
  modeId: ModeId;
  justification: string;
  vote: VoteDecision | null;
  planVersion: number | null;
  planTotalRisk: number | null;
  hitlThreshold: number;
}): OutputSchemaRecord {
  const mode = getMode(input.modeId);
  return OutputSchemaRecord.parse({
    round: input.round,
    agent_id: OFFICER_ID[input.dept],
    proposal: {
      mode_id: mode.id,
      mode_tier: mode.tier,
      oxygen_units: mode.resources.oxygen,
      water_liters: mode.resources.water,
      power_kwh: mode.resources.power,
      robot_time_units: mode.resources.robot,
      bandwidth_units: mode.resources.bandwidth,
      food_rations: null,
      justification: input.justification,
    },
    vote: input.vote === null ? null : input.vote === 'ACCEPT' ? 'APPROVE' : 'REJECT',
    plan_version: input.planVersion,
    risk_score: mode.risk,
    plan_total_risk: input.planTotalRisk,
    flag_human_review: (input.planTotalRisk ?? 0) > input.hitlThreshold,
  });
}
