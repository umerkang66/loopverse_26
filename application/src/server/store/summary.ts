import 'server-only';
import type { SessionListEntry, SessionSummary } from '@/domain/api';
import type { SessionState } from '@/domain/types';

export type { SessionListEntry, SessionSummary };

export function sessionSummary(s: SessionState): SessionSummary {
  return {
    scenarios: s.scenarios.map((sc) => ({
      id: sc.id,
      kind: sc.kind,
      title: sc.title,
      outcome: sc.outcome,
      approvedPlanVersion: sc.approvedPlanVersion,
      round: sc.round,
    })),
    messageCount: s.messages.length,
    planCount: s.plans.length,
    mode: s.config.mode,
  };
}
