import 'server-only';
import type { SessionState } from '@/domain/types';

export interface SessionSummary {
  scenarios: { id: string; kind: string; title: string; outcome: string | null; approvedPlanVersion: number | null; round: number }[];
  messageCount: number;
  planCount: number;
  mode: 'live' | 'offline';
}

export interface SessionListEntry {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'archived';
  summary: SessionSummary;
}

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
