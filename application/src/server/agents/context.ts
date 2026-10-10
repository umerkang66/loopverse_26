import 'server-only';
import type { AgentId } from '@/domain/types';
import type { EngineFacade } from '../orchestrator/engine-facade';

/** Local run context passed to every agent run (never sent to the model). */
export interface AgentRunContext {
  facade: EngineFacade;
  agentId: AgentId;
  scenarioId: string;
  round: number;
  /** Facts the output guardrails check against (e.g. the plan version on a ballot). */
  expect: { planVersion?: number; allowDraftless?: boolean };
}
