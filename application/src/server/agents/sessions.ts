import 'server-only';
import { MemorySession, type AgentInputItem } from '@openai/agents';
import type { AgentId } from '@/domain/types';

/**
 * Each council member owns ONE private SDK session (its own message history), persisted with its state
 * (Supabase table ares_agent_memory). Agents never see each other's sessions.
 */
export class AgentSessions {
  private sessions = new Map<string, MemorySession>();

  get(sessionId: string, agentId: AgentId, initialItems: unknown[]): MemorySession {
    const key = `${sessionId}:${agentId}`;
    let session = this.sessions.get(key);
    if (!session) {
      session = new MemorySession({ sessionId: key, initialItems: initialItems as AgentInputItem[] });
      this.sessions.set(key, session);
    }
    return session;
  }

  clear(): void {
    this.sessions.clear();
  }
}

type Loose = { role?: string; type?: string; content?: unknown };

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text: unknown }).text) : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/**
 * Bounded context: keep only the last `n` user/assistant MESSAGE items, rebuilt without ids. Tool calls and
 * reasoning items are dropped so call/result pairs can never be split; long-term continuity comes from the
 * private memory notes in every packet.
 */
export function keepLastMessages(history: AgentInputItem[], n: number): AgentInputItem[] {
  const messages: AgentInputItem[] = [];
  for (const raw of history) {
    const item = raw as Loose;
    if (item.type && item.type !== 'message') continue;
    const text = textOf(item.content);
    if (!text) continue;
    if (item.role === 'user') messages.push({ role: 'user', content: text });
    else if (item.role === 'assistant') {
      messages.push({ role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] } as AgentInputItem);
    }
  }
  return messages.slice(-n);
}
