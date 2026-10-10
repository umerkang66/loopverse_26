import 'server-only';
import type { StreamEvent } from '@/domain/stream';

export type { StreamEvent };

type Listener = (id: number, event: StreamEvent) => void;

/** In-process pub/sub with a ring buffer so SSE clients can resume with Last-Event-ID. */
export class EventBus {
  private buffer: { id: number; event: StreamEvent }[] = [];
  private listeners = new Set<Listener>();
  private nextId = 1;

  constructor(private readonly capacity = 2000) {}

  publish(event: StreamEvent): number {
    const id = this.nextId++;
    this.buffer.push({ id, event });
    if (this.buffer.length > this.capacity) this.buffer.splice(0, this.buffer.length - this.capacity);
    for (const listener of this.listeners) {
      try {
        listener(id, event);
      } catch {
        // a broken listener (closed stream) must never break the negotiation
      }
    }
    return id;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Events after `lastId`; null when `lastId` is older than the buffer (client must resync). */
  since(lastId: number): { id: number; event: StreamEvent }[] | null {
    if (lastId <= 0) return [];
    const oldest = this.buffer[0]?.id ?? this.nextId;
    if (lastId < oldest - 1) return null;
    return this.buffer.filter((entry) => entry.id > lastId);
  }

  lastId(): number {
    return this.nextId - 1;
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}
