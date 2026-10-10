import 'server-only';
import { Agent, retryPolicies, type Model, type ModelSettings } from '@openai/agents';
import { PROFILES } from '@/domain/scenario';
import type { AgentId, DepartmentId } from '@/domain/types';
import type { ServerEnv } from '../env';
import type { AgentRunContext } from './context';
import { ballotGuardrail, synthesisGuardrail } from './guardrails';
import { buildCommanderInstructions } from './prompts/commander';
import { buildDepartmentInstructions } from './prompts/department';
import {
  BallotSchema,
  CommanderBriefingSchema,
  CommanderDecisionSchema,
  CommanderSynthesisSchema,
  ConsentSchema,
  departmentTurnSchema,
} from './schemas';
import { commitmentLedgerTool, evaluateCombinationTool, explainInfeasibilityTool, listFeasiblePlansTool } from './tools';

export type DepartmentKind = 'turn' | 'ballot' | 'consent';
export type CommanderKind = 'briefing' | 'synthesis' | 'decision';
export type AgentKind = DepartmentKind | CommanderKind;

type Effort = 'none' | 'minimal' | 'low' | 'medium' | 'high';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAgent = Agent<AgentRunContext, any>;

/**
 * One SDK Agent per (council member × output kind). All kinds of a member share the same instructions and the
 * same private session, so the member has ONE message history. Built with `new Agent` per kind because
 * `agent.clone()` keeps the original output type.
 */
export class AgentFactory {
  private cache = new Map<string, AnyAgent>();
  private unavailable = new Set<string>();
  private extrasDisabled = false;

  constructor(
    private readonly env: ServerEnv,
    /** Tests inject a ScriptedModel here; production uses model names. */
    private readonly testModel?: Model,
  ) {
    this.extrasDisabled = env.OPENAI_TEXT_VERBOSITY === 'off';
  }

  modelFor(agentId: AgentId): string {
    const primary = agentId === 'COMMANDER' ? this.env.OPENAI_MODEL_COMMANDER : this.env.OPENAI_MODEL_DEPARTMENTS;
    return this.unavailable.has(primary) ? this.env.OPENAI_FALLBACK_MODEL : primary;
  }

  /** The configured model does not exist for this key: switch to the fallback model. */
  markUnavailable(model: string): boolean {
    if (model === this.env.OPENAI_FALLBACK_MODEL || this.unavailable.has(model)) return false;
    this.unavailable.add(model);
    this.cache.clear();
    return true;
  }

  /** Drop optional request parameters (verbosity / reasoning effort) after a 400 "unsupported parameter". */
  disableExtras(): boolean {
    if (this.extrasDisabled) return false;
    this.extrasDisabled = true;
    this.cache.clear();
    return true;
  }

  private settings(effort: Effort, maxTokens: number): ModelSettings {
    const base: ModelSettings = {
      maxTokens,
      timeoutMs: this.env.MODEL_CALL_TIMEOUT_MS,
      retry: {
        maxRetries: 1,
        policy: retryPolicies.any(retryPolicies.networkError(), retryPolicies.httpStatus([429, 500, 502, 503, 504]), retryPolicies.retryAfter()),
      },
    };
    if (this.extrasDisabled) return base;
    return {
      ...base,
      reasoning: { effort },
      ...(this.env.OPENAI_TEXT_VERBOSITY !== 'off' ? { text: { verbosity: this.env.OPENAI_TEXT_VERBOSITY as 'low' | 'medium' | 'high' } } : {}),
    };
  }

  get(agentId: AgentId, kind: AgentKind): AnyAgent {
    const model = this.modelFor(agentId);
    const key = `${agentId}:${kind}:${model}`;
    let agent = this.cache.get(key);
    if (!agent) this.cache.set(key, (agent = agentId === 'COMMANDER' ? this.commander(kind as CommanderKind, model) : this.department(agentId, kind as DepartmentKind, model)));
    return this.testModel ? agent.clone({ model: this.testModel }) : agent;
  }

  private department(dept: DepartmentId, kind: DepartmentKind, model: string): AnyAgent {
    const p = PROFILES[dept];
    const effort = this.env.OPENAI_REASONING_EFFORT_DEPARTMENTS as Effort;
    const name = `${p.callsign} · ${p.departmentName}${kind === 'turn' ? '' : ` (${kind})`}`;
    const instructions = buildDepartmentInstructions(dept);
    if (kind === 'ballot') {
      return new Agent<AgentRunContext, typeof BallotSchema>({
        name,
        instructions,
        model,
        modelSettings: this.settings('none', 1200),
        outputType: BallotSchema,
        outputGuardrails: [ballotGuardrail],
      });
    }
    if (kind === 'consent') {
      return new Agent<AgentRunContext, typeof ConsentSchema>({
        name,
        instructions,
        model,
        modelSettings: this.settings(effort, 2000),
        outputType: ConsentSchema,
      });
    }
    return new Agent<AgentRunContext, ReturnType<typeof departmentTurnSchema>>({
      name,
      instructions,
      model,
      modelSettings: this.settings(effort, 3000),
      tools: [evaluateCombinationTool, commitmentLedgerTool],
      outputType: departmentTurnSchema(dept),
    });
  }

  private commander(kind: CommanderKind, model: string): AnyAgent {
    const p = PROFILES.COMMANDER;
    const effort = this.env.OPENAI_REASONING_EFFORT_COMMANDER as Effort;
    const name = `${p.callsign} · Commander${kind === 'synthesis' ? '' : ` (${kind})`}`;
    const instructions = buildCommanderInstructions();
    if (kind === 'briefing') {
      return new Agent<AgentRunContext, typeof CommanderBriefingSchema>({
        name,
        instructions,
        model,
        modelSettings: this.settings(effort, 2000),
        outputType: CommanderBriefingSchema,
      });
    }
    if (kind === 'decision') {
      return new Agent<AgentRunContext, typeof CommanderDecisionSchema>({
        name,
        instructions,
        model,
        modelSettings: this.settings(effort, 1500),
        outputType: CommanderDecisionSchema,
      });
    }
    return new Agent<AgentRunContext, typeof CommanderSynthesisSchema>({
      name,
      instructions,
      model,
      modelSettings: this.settings(effort, 4000),
      tools: [listFeasiblePlansTool, evaluateCombinationTool, explainInfeasibilityTool, commitmentLedgerTool],
      outputType: CommanderSynthesisSchema,
      outputGuardrails: [synthesisGuardrail],
    });
  }
}
