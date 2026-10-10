import 'server-only';
import { createHash } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';

/** Time-ordered UUIDv7 (the Supabase primary key of a session; no index fragmentation). */
export function newSessionId(): string {
  return uuidv7();
}

export function messageId(seq: number): string {
  return `M-${String(seq).padStart(4, '0')}`;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
