import 'server-only';
import { AGENT_IDS, type ComplianceItem, type MessageSource, type SessionState } from '@/domain/types';
import { computeCompliance } from '@/engine/compliance';

/** The full, self-describing session export. Every message keeps `source`, so FALLBACK output stays labeled. */
export function jsonExport(s: SessionState, extraCompliance: ComplianceItem[] = [], now = new Date().toISOString()) {
  const count = (source: MessageSource) => s.messages.filter((m) => m.source === source).length;
  return {
    meta: {
      exportedAt: now,
      app: 'ARES ACCORD',
      sessionId: s.id,
      instanceId: s.instanceId,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      mode: s.config.mode,
      models: s.config.models,
      llmMessages: count('LLM'),
      fallbackMessages: count('FALLBACK'),
      deterministicMessages: count('DETERMINISTIC'),
      humanMessages: count('HUMAN'),
      catalogHash: s.catalogHash,
      scenarioConfigId: s.scenarioConfigId,
      sourceLegend: {
        LLM: 'Written by the agent\'s live model call (OpenAI Agents SDK)',
        FALLBACK: 'Rule-based policy used only because the model call failed (reason in meta.fallbackReason)',
        DETERMINISTIC: 'Engine, validator, or system record',
        HUMAN: 'Mission Control (judge) action',
      },
    },
    config: s.config,
    run: s.run,
    planInForceVersion: s.planInForceVersion,
    scenarios: s.scenarios,
    events: s.events,
    plans: s.plans,
    commitments: s.commitments,
    messages: s.messages,
    agents: AGENT_IDS.map((id) => {
      const { sessionItems, ...agent } = s.agents[id];
      return { ...agent, sessionItemCount: sessionItems.length };
    }),
    compliance: computeCompliance(s, extraCompliance),
  };
}
