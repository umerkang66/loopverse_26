import 'server-only';
import { tool, type RunContext } from '@openai/agents';
import { z } from 'zod';
import type { AgentRunContext } from './context';
import { SelectionsSchema } from './schemas';

function ctxOf(runContext: RunContext<AgentRunContext> | undefined): AgentRunContext {
  if (!runContext?.context) throw new Error('Tool called without a run context');
  return runContext.context;
}

export const evaluateCombinationTool = tool({
  name: 'evaluate_combination',
  description:
    'Deterministically evaluate a COMPLETE four-mode combination against the CURRENT pool and policy (and Crisis Override when relevant). Returns totals, overages, risk, sacrifices, reserve and violations.',
  parameters: SelectionsSchema,
  execute: async (selections, runContext?: RunContext<AgentRunContext>) => JSON.stringify(ctxOf(runContext).facade.evaluate(selections)),
});

export const listFeasiblePlansTool = tool({
  name: 'list_feasible_plans',
  description:
    'Exhaustive search over all 81 combinations. Lists the feasible plans (max 8), ranked by fewest Sacrifice modes, fairness, risk and reserve, with the reasons.',
  parameters: z.object({ policy: z.enum(['CURRENT', 'CRISIS_OVERRIDE']) }),
  execute: async ({ policy }, runContext?: RunContext<AgentRunContext>) => JSON.stringify(ctxOf(runContext).facade.feasible(policy)),
});

export const explainInfeasibilityTool = tool({
  name: 'explain_infeasibility',
  description: 'Infeasibility certificate: blocking constraints, closest combinations with shortfalls, and the exact extra resource or policy change needed.',
  parameters: z.object({}),
  execute: async (_input, runContext?: RunContext<AgentRunContext>) => JSON.stringify(ctxOf(runContext).facade.certificate()),
});

export const commitmentLedgerTool = tool({
  name: 'get_commitment_ledger',
  description: 'Commitments you are party to (the Commander sees all), with status and whether each is affordable in the latest plan.',
  parameters: z.object({}),
  execute: async (_input, runContext?: RunContext<AgentRunContext>) => {
    const ctx = ctxOf(runContext);
    return JSON.stringify(ctx.facade.ledger(ctx.agentId));
  },
});
