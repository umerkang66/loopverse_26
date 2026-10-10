import 'server-only';

export type DbErrorKind = 'RETRYABLE' | 'CONFIG' | 'DATA';

export interface ClassifiedDbError {
  kind: DbErrorKind;
  code: string;
  message: string;
  hint: string;
}

export class DbError extends Error {
  constructor(
    readonly classified: ClassifiedDbError,
    readonly table?: string,
  ) {
    super(`${table ? `${table}: ` : ''}${classified.message}`);
  }
}

/** Classify a PostgREST/network failure into retryable, configuration, or data errors (with an actionable hint). */
export function classifyDbError(error: unknown, status?: number): ClassifiedDbError {
  const e = (error ?? {}) as { code?: string; message?: string; details?: string; hint?: string; name?: string };
  const code = String(e.code ?? (status ? `HTTP${status}` : ''));
  const message = String(e.message ?? error ?? 'unknown database error');
  if (code === '42501') {
    return { kind: 'CONFIG', code, message, hint: 'Missing GRANT for service_role: run the GRANT block of supabase/migrations/*_ares_init.sql (phase1 §7.2.2).' };
  }
  if (code === 'PGRST205' || code === '42P01' || /schema cache|does not exist/i.test(message)) {
    return { kind: 'CONFIG', code: code || 'PGRST205', message, hint: 'Tables not found: apply supabase/migrations/*_ares_init.sql to this project (Dashboard SQL Editor or npm run db:push).' };
  }
  if (status === 401 || status === 403 || code === 'PGRST301' || code === 'PGRST302' || /invalid api key|jwt/i.test(message)) {
    return { kind: 'CONFIG', code: code || `HTTP${status}`, message, hint: 'Check SUPABASE_URL and SUPABASE_SECRET_KEY (server-only sb_secret_ key).' };
  }
  if (/^2[23]/.test(code)) {
    return { kind: 'DATA', code, message, hint: 'A row violated a database constraint; it was skipped and logged.' };
  }
  return { kind: 'RETRYABLE', code: code || 'NETWORK', message, hint: 'Database unreachable or busy; writes are buffered and retried (local snapshot is safe).' };
}
