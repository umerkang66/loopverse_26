import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ServerEnv } from '../env';

declare global {
  var __aresSupabase: SupabaseClient | undefined;
}

/** Server-only admin client (secret key → role service_role). The browser never talks to Supabase. */
export function getSupabaseAdmin(env: Pick<ServerEnv, 'storageDriver' | 'SUPABASE_URL' | 'SUPABASE_SECRET_KEY'>): SupabaseClient | null {
  if (env.storageDriver !== 'supabase' || !env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return null;
  globalThis.__aresSupabase ??= createSupabaseAdmin(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);
  return globalThis.__aresSupabase;
}

export function createSupabaseAdmin(url: string, secretKey: string): SupabaseClient {
  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, // no user sessions on the server
  });
}
