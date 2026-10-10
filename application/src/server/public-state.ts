import 'server-only';
import { AGENT_IDS, type AgentId, type ComplianceItem, type PublicAgentState, type PublicState, type SessionState, type StorageStatus } from '@/domain/types';
import { computeCompliance } from '@/engine/compliance';

/** The PERSISTED compliance item depends on the database, so the runtime (not the pure engine) adds it. */
export function persistedItem(s: SessionState, storage: StorageStatus): ComplianceItem {
  const label = 'Complete, persistent history of all scenarios';
  if (storage.driver === 'file') {
    return { id: 'PERSISTED', label, scope: 'SYSTEM', status: 'NA', evidence: [], detail: 'Local file store (Supabase not configured)' };
  }
  const total = s.messages.length;
  const inDb = storage.dbMessageCount;
  const synced = storage.state === 'SYNCED' && storage.pendingRows === 0;
  const status = storage.state === 'ERROR' ? 'FAIL' : synced && inDb === total ? 'PASS' : 'PENDING';
  return {
    id: 'PERSISTED',
    label,
    scope: 'SYSTEM',
    status,
    evidence: [],
    detail:
      storage.state === 'ERROR'
        ? `Database error: ${storage.lastError?.hint ?? 'unknown'}`
        : `${inDb ?? '?'}/${total} messages persisted to Supabase · ${storage.state.toLowerCase()}${storage.lastSyncAt ? ` · last sync ${storage.lastSyncAt}` : ''}`,
  };
}

export function toPublicState(s: SessionState, storage: StorageStatus): PublicState {
  const { messages, agents, ...rest } = s;
  const publicAgents = Object.fromEntries(
    AGENT_IDS.map((id) => {
      const { sessionItems, ...agent } = agents[id];
      return [id, { ...agent, sessionItemCount: sessionItems.length } satisfies PublicAgentState];
    }),
  ) as Record<AgentId, PublicAgentState>;
  return {
    ...rest,
    agents: publicAgents,
    messageCount: messages.length,
    storage,
    compliance: computeCompliance(s, [persistedItem(s, storage)]),
  };
}
