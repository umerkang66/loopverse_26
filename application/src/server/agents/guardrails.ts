import 'server-only';
import type { OutputGuardrail } from '@openai/agents';
import type { AgentRunContext } from './context';
import type { BallotOutput, BallotSchema, CommanderSynthesisSchema, SynthesisOutput } from './schemas';

/** Semantic checks the JSON schema cannot express. A trip becomes a repair retry in the gateway. */

export function ballotIssues(output: BallotOutput, expectedVersion: number | undefined): string[] {
  if (expectedVersion !== undefined && output.planVersion !== expectedVersion) {
    return [`planVersion must be ${expectedVersion} (you voted on v${output.planVersion})`];
  }
  return [];
}

export function synthesisIssues(output: SynthesisOutput): string[] {
  const issues: string[] = [];
  if (output.action === 'DRAFT_PLAN' && !output.plan) issues.push('action DRAFT_PLAN requires a non-null plan');
  return issues;
}

// Agents take plain { name, execute } guardrails (the SDK wraps them itself).
export const ballotGuardrail: OutputGuardrail<typeof BallotSchema, AgentRunContext> = {
  name: 'ballot-binds-to-version',
  execute: async ({ agentOutput, context }) => {
    const issues = ballotIssues(agentOutput, context.context.expect.planVersion);
    return { tripwireTriggered: issues.length > 0, outputInfo: issues };
  },
};

export const synthesisGuardrail: OutputGuardrail<typeof CommanderSynthesisSchema, AgentRunContext> = {
  name: 'draft-has-plan',
  execute: async ({ agentOutput }) => {
    const issues = synthesisIssues(agentOutput);
    return { tripwireTriggered: issues.length > 0, outputInfo: issues };
  },
};
