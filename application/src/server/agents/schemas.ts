import 'server-only';
import { z } from 'zod';
import { DEPT_MODES, SACRIFICE_MODES } from '@/domain/constants';
import { DEPARTMENT_IDS, RESOURCE_KEYS, type DepartmentId } from '@/domain/types';

// OpenAI strict structured outputs: every field required, optional values are `.nullable()`, no records,
// no refinements, no min/max (limits are enforced in code after parsing). Per-department enums make it
// impossible for an agent to request another department's package.

const ResourceEnum = z.enum(RESOURCE_KEYS);
const Expiry = z.object({
  unit: z.enum(['HOURS', 'CYCLES', 'SCENARIOS']),
  value: z.number().int(),
  label: z.string().describe('Human label, e.g. "48 hours" or "next cycle".'),
});
const SacrificeModeEnum = z.enum(SACRIFICE_MODES);

export const SelectionsSchema = z.object({
  LIFE_SUPPORT: z.enum(DEPT_MODES.LIFE_SUPPORT),
  MEDICAL: z.enum(DEPT_MODES.MEDICAL),
  FOOD: z.enum(DEPT_MODES.FOOD),
  ENGINEERING: z.enum(DEPT_MODES.ENGINEERING),
});

export type NarrowSelections = z.infer<typeof SelectionsSchema>;

const ClaimedTotals = z.object({
  power: z.number(),
  water: z.number(),
  oxygen: z.number(),
  robot: z.number(),
  bandwidth: z.number(),
});

function buildDepartmentTurnSchema(dept: DepartmentId) {
  const others = DEPARTMENT_IDS.filter((d) => d !== dept) as [DepartmentId, ...DepartmentId[]];
  return z.object({
    publicStatement: z.string().describe('What you say to the whole council this turn. First person, at most 60 words, cite numbers.'),
    requestedMode: z.enum(DEPT_MODES[dept]).describe('The ONE complete package you request now.'),
    consequence: z.string().describe('What your department gains or loses under the requested mode (one sentence).'),
    reason: z.string().describe('Why you request it now, numbers-first (one sentence).'),
    claimedTotals: ClaimedTotals.nullable().describe('If you cite combined totals for a combination, state them here; the validator will check them. Otherwise null.'),
    sacrificeStance: z.enum(['REFUSE', 'CONDITIONAL', 'ACCEPT', 'NOT_ASKED']),
    sacrificeConditions: z.array(z.string()).describe('If REFUSE or CONDITIONAL: the concrete returns you would need.'),
    objections: z
      .array(
        z.object({
          kind: z.enum(['RESOURCE_CONFLICT', 'UNFAIR_SACRIFICE', 'SACRIFICE_REFUSAL', 'RISK_LIMIT', 'MISSING_RETURN', 'INVALID_PLAN', 'OTHER']),
          target: z.enum(['PLAN', 'COMMANDER', ...others]),
          detail: z.string(),
        }),
      )
      .describe('At most 3.'),
    counteroffer: SelectionsSchema.extend({
      compensationTerms: z.string(),
      rationale: z.string(),
    })
      .nullable()
      .describe('A COMPLETE alternative four-mode combination with compensation terms, or null.'),
    commitmentOffers: z
      .array(
        z.object({
          beneficiary: z.enum(others),
          kind: z.enum(['RESOURCE_SHARE', 'PRIORITY', 'FUTURE_RESOURCE', 'OTHER']),
          resource: ResourceEnum.nullable(),
          amount: z.number().int().nullable(),
          promise: z.string(),
          expiry: Expiry,
          onlyIfSacrificeMode: SacrificeModeEnum.nullable(),
        }),
      )
      .describe('Return commitments YOU offer to a department that would take a Sacrifice mode. At most 2.'),
    commitmentResponses: z
      .array(z.object({ commitmentId: z.string(), decision: z.enum(['ACCEPT', 'DECLINE']), reason: z.string() }))
      .describe('Responses to commitment offers addressed to YOU (by id).'),
    privateNote: z.string().describe('Private memory for your future self. Never shown to other agents.'),
  });
}

const deptTurnCache = new Map<DepartmentId, ReturnType<typeof buildDepartmentTurnSchema>>();
export function departmentTurnSchema(dept: DepartmentId) {
  let schema = deptTurnCache.get(dept);
  if (!schema) deptTurnCache.set(dept, (schema = buildDepartmentTurnSchema(dept)));
  return schema;
}
export type DepartmentTurnOutput = z.infer<ReturnType<typeof buildDepartmentTurnSchema>>;

export const BallotSchema = z.object({
  planVersion: z.number().int().describe('Must equal the version on the ballot.'),
  decision: z.enum(['ACCEPT', 'REJECT']),
  reason: z.string().describe('One or two sentences, numbers-first.'),
  conditionsForAccept: z.array(z.string()),
  privateNote: z.string(),
});
export type BallotOutput = z.infer<typeof BallotSchema>;

export const ConsentSchema = z.object({
  statement: z.string().describe('At most 50 words, first person.'),
  sacrificeStance: z.enum(['REFUSE', 'CONDITIONAL', 'ACCEPT']),
  responses: z.array(z.object({ commitmentId: z.string(), decision: z.enum(['ACCEPT', 'DECLINE']), reason: z.string() })),
  additionalReturnNeeded: z.string().nullable(),
  privateNote: z.string(),
});
export type ConsentOutput = z.infer<typeof ConsentSchema>;

const AskSchema = z.object({ to: z.enum(['ALL', ...DEPARTMENT_IDS]), ask: z.string() });

export const CommanderBriefingSchema = z.object({
  statement: z.string().describe('At most 90 words: crisis or event, pool, limits, plan in force, round limit, deadline.'),
  asks: z.array(AskSchema),
  privateNote: z.string(),
});
export type BriefingOutput = z.infer<typeof CommanderBriefingSchema>;

const CommanderCommitment = z.object({
  beneficiary: z.enum(DEPARTMENT_IDS),
  kind: z.enum(['RESERVE_ASSIGNMENT', 'PRIORITY', 'FUTURE_RESOURCE', 'OTHER']),
  resource: ResourceEnum.nullable(),
  amount: z.number().int().nullable(),
  promise: z.string(),
  expiry: Expiry,
  onlyIfSacrificeMode: SacrificeModeEnum.nullable(),
});

export const CommanderSynthesisSchema = z.object({
  analysis: z.string().describe('At most 90 words: public assessment with numbers.'),
  conflicts: z.array(z.string()),
  action: z.enum(['DRAFT_PLAN', 'REQUEST_CHANGES', 'DECLARE_INFEASIBLE']),
  invokeCrisisOverride: z.boolean(),
  overrideJustification: z.string(),
  plan: SelectionsSchema.extend({
    label: z.string().describe('Short name, e.g. "Path B — Engineering sacrifices".'),
    includeCommitmentIds: z.array(z.string()),
    rationale: z.string().describe('Why this plan and why this department sacrifices.'),
  }).nullable(),
  commanderCommitments: z.array(CommanderCommitment),
  directives: z.array(AskSchema),
  responsesToObjections: z.array(z.object({ messageId: z.string(), response: z.string() })),
  nextRoundBrief: z.string().describe('At most 70 words: opening statement for the next round.'),
  privateNote: z.string(),
});
export type SynthesisOutput = z.infer<typeof CommanderSynthesisSchema>;

export const CommanderDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'CONTINUE', 'DEADLOCK', 'INFEASIBLE']),
  statement: z.string().describe('At most 80 words: plan version, final validation result, votes; or the blocking reasons and what is needed.'),
  privateNote: z.string(),
});
export type DecisionOutput = z.infer<typeof CommanderDecisionSchema>;
