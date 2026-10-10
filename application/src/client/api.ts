'use client';

import { toast } from 'sonner';
import type {
  HealthResponse,
  InterpretRequestBody,
  InterpretResponse,
  SessionResponse,
  SessionsResponse,
  StateResponse,
} from '@/domain/api';
import type { EventInterpretation, ResourceVector } from '@/domain/types';

const CODE_KEY = 'ares.judgeCode';

export function getJudgeCode(): string {
  try {
    return localStorage.getItem(CODE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setJudgeCode(code: string): void {
  try {
    if (code) localStorage.setItem(CODE_KEY, code);
    else localStorage.removeItem(CODE_KEY);
  } catch {
    // storage unavailable (private mode): the code lives for this page only
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Unauthorized = () => void;
let onUnauthorized: Unauthorized = () => undefined;
/** The dashboard registers a handler that opens the judge access-code dialog on 401. */
export function setUnauthorizedHandler(handler: Unauthorized): void {
  onUnauthorized = handler;
}

async function request<T>(path: string, init: RequestInit & { quiet?: boolean } = {}): Promise<T> {
  const { quiet, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (rest.method && rest.method !== 'GET') {
    headers.set('content-type', 'application/json');
    const code = getJudgeCode();
    if (code) headers.set('x-judge-code', code);
  }
  let res: Response;
  try {
    res = await fetch(path, { ...rest, headers, cache: 'no-store' });
  } catch {
    const err = new ApiError(0, 'The server is unreachable. Is `npm run dev` running?');
    if (!quiet) toast.error(err.message);
    throw err;
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    const err = new ApiError(res.status, body.error ?? `Request failed (HTTP ${res.status})`);
    if (res.status === 401) onUnauthorized();
    if (!quiet) toast.error(err.message);
    throw err;
  }
  return body;
}

const post = <T>(path: string, body: unknown = {}, quiet = false) => request<T>(path, { method: 'POST', body: JSON.stringify(body), quiet });

export const api = {
  state: (sinceSeq = 0) => request<StateResponse>(`/api/state${sinceSeq ? `?sinceSeq=${sinceSeq}` : ''}`, { quiet: true }),
  health: (deep = false) => request<HealthResponse>(`/api/health${deep ? '?deep=1' : ''}`),
  start: (body: { resources?: ResourceVector; maxRounds?: number; deadlineSeconds?: number }) => post<{ sessionId: string; scenarioId: string }>('/api/control/start', body),
  resume: () => post<{ scenarioId: string }>('/api/control/resume'),
  reset: (body: { hard?: boolean; confirm?: string } = {}) => post<{ sessionId: string }>('/api/control/reset', body),
  countersign: (decision: 'COUNTERSIGN' | 'VETO', reason = '') => post<{ scenarioId: string }>('/api/control/countersign', { decision, reason }),
  interpret: (body: InterpretRequestBody) => post<InterpretResponse>('/api/events/interpret', body),
  apply: (interpretation: EventInterpretation) => post<{ scenarioId: string; eventId: string }>('/api/events/apply', { interpretation }),
  sessions: () => request<SessionsResponse>('/api/sessions'),
  session: (id: string) => request<SessionResponse>(`/api/sessions/${encodeURIComponent(id)}`),
};

export type ExportKind = 'json' | 'transcript' | 'plans' | 'votes' | 'commitments' | 'final';

export function exportUrl(kind: ExportKind, opts: { sessionId?: string | null; scenarioId?: string | null } = {}): string {
  const q = new URLSearchParams();
  if (kind === 'json' || kind === 'final') q.set('format', kind);
  else {
    q.set('format', 'csv');
    q.set('kind', kind);
  }
  if (opts.sessionId) q.set('sessionId', opts.sessionId);
  if (opts.scenarioId && kind === 'final') q.set('scenario', opts.scenarioId);
  return `/api/export?${q.toString()}`;
}
