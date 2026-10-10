import 'server-only';
import { z } from 'zod';

const effort = z.enum(['none', 'minimal', 'low', 'medium', 'high']);
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));
const int = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? Number.parseInt(v, 10) : fallback))
    .pipe(z.number().int().positive());

const EnvSchema = z.object({
  OPENAI_API_KEY: optionalString,
  AGENT_MODE: z
    .string()
    .optional()
    .transform((v) => (v === 'live' || v === 'offline' ? v : undefined)),
  OPENAI_MODEL_COMMANDER: z.string().optional().transform((v) => v?.trim() || 'gpt-5.6-terra'),
  OPENAI_MODEL_DEPARTMENTS: z.string().optional().transform((v) => v?.trim() || 'gpt-5.6-terra'),
  OPENAI_FALLBACK_MODEL: z.string().optional().transform((v) => v?.trim() || 'gpt-5.4-mini'),
  OPENAI_REASONING_EFFORT_COMMANDER: z.string().optional().transform((v) => v?.trim() || 'low').pipe(effort),
  OPENAI_REASONING_EFFORT_DEPARTMENTS: z.string().optional().transform((v) => v?.trim() || 'low').pipe(effort),
  OPENAI_TRACING: z.string().optional().transform((v) => (v?.trim().toLowerCase() === 'off' ? 'off' : 'on')),
  OPENAI_TEXT_VERBOSITY: z.string().optional().transform((v) => (v === 'off' ? 'off' : v === 'medium' || v === 'high' ? v : 'low')),
  MODEL_CALL_TIMEOUT_MS: int(25_000),
  AGENT_TURN_TIMEOUT_MS: int(35_000),
  MAX_ROUNDS_BASELINE: int(6),
  MAX_ROUNDS_EVENT: int(5),
  DEADLINE_BASELINE_SECONDS: int(300),
  DEADLINE_EVENT_SECONDS: int(170),
  // On by default (bonus: human approval when risk > threshold). Set HITL_ENABLED=false to disable.
  HITL_ENABLED: z.string().optional().transform((v) => v?.trim().toLowerCase() !== 'false'),
  HITL_RISK_THRESHOLD: int(20),
  DATA_DIR: z.string().optional().transform((v) => v?.trim() || './data'),
  JUDGE_ACCESS_CODE: optionalString,
  SUPABASE_URL: optionalString,
  SUPABASE_SECRET_KEY: optionalString,
  DB_PASSWORD: optionalString,
  STORAGE_DRIVER: z
    .string()
    .optional()
    .transform((v) => (v === 'supabase' || v === 'file' ? v : 'auto')),
  ARES_INSTANCE_ID: z
    .string()
    .optional()
    .transform((v) => (v?.trim() || 'local').replace(/[^a-zA-Z0-9._-]/g, '-')),
  DB_FLUSH_MS: int(200),
  DB_TIMEOUT_MS: int(8_000),
});

export type ServerEnv = z.infer<typeof EnvSchema> & {
  mode: 'live' | 'offline';
  storageDriver: 'supabase' | 'file';
  supabaseHost: string | null;
};

/** Values that must never be reachable from the browser or the logs. */
export function secretValues(env: Pick<ServerEnv, 'OPENAI_API_KEY' | 'SUPABASE_SECRET_KEY' | 'DB_PASSWORD' | 'JUDGE_ACCESS_CODE'>): string[] {
  return [env.OPENAI_API_KEY, env.SUPABASE_SECRET_KEY, env.DB_PASSWORD, env.JUDGE_ACCESS_CODE].filter(
    (v): v is string => typeof v === 'string' && v.length >= 6,
  );
}

/** Next.js inlines NEXT_PUBLIC_* into browser bundles: refuse to boot if any of them carries a secret. */
export function assertNoPublicSecrets(source: Record<string, string | undefined>, env: ServerEnv): void {
  const secrets = secretValues(env);
  for (const [name, value] of Object.entries(source)) {
    if (!name.startsWith('NEXT_PUBLIC_') || !value) continue;
    if (value.startsWith('sb_secret_') || secrets.includes(value)) {
      throw new Error(`Fatal configuration error: a secret is exposed through the public variable ${name}. Remove it from .env.`);
    }
  }
}

export function parseServerEnv(source: Record<string, string | undefined> = process.env, overrides: Partial<ServerEnv> = {}): ServerEnv {
  const parsed = EnvSchema.parse(source);
  const mode = overrides.mode ?? parsed.AGENT_MODE ?? (parsed.OPENAI_API_KEY ? 'live' : 'offline');
  const requested = overrides.STORAGE_DRIVER ?? parsed.STORAGE_DRIVER;
  const hasSupabase = Boolean((overrides.SUPABASE_URL ?? parsed.SUPABASE_URL) && (overrides.SUPABASE_SECRET_KEY ?? parsed.SUPABASE_SECRET_KEY));
  const storageDriver = overrides.storageDriver ?? (requested === 'file' ? 'file' : requested === 'supabase' ? 'supabase' : hasSupabase ? 'supabase' : 'file');
  const url = overrides.SUPABASE_URL ?? parsed.SUPABASE_URL;
  let supabaseHost: string | null = null;
  try {
    supabaseHost = url ? new URL(url).host : null;
  } catch {
    supabaseHost = null;
  }
  const env: ServerEnv = { ...parsed, ...overrides, mode, storageDriver, supabaseHost };
  if (env.storageDriver === 'supabase' && !hasSupabase) {
    throw new Error('STORAGE_DRIVER=supabase requires SUPABASE_URL and SUPABASE_SECRET_KEY.');
  }
  assertNoPublicSecrets(source, env);
  return env;
}

let cached: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv();
  return cached;
}
