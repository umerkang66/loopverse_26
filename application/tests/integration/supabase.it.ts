// `npm run test:db`: talks to the Supabase project in .env under a throwaway instance id, then deletes its rows.
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { SessionState } from '@/domain/types';
import { createSupabaseAdmin } from '@/server/db/supabase';
import { AresRuntime } from '@/server/runtime';
import { injectPreset, runBaseline } from './helpers';

const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
const instances: string[] = [];
const dirs: string[] = [];
const runtimes: AresRuntime[] = [];

function newInstance(): string {
  const id = `it-${randomUUID().slice(0, 8)}`;
  instances.push(id);
  return id;
}

/** Each runtime gets an empty DATA_DIR, so a reload can only come from Supabase. */
function runtime(instance: string): AresRuntime {
  const dir = mkdtempSync(path.join(tmpdir(), 'ares-it-'));
  dirs.push(dir);
  const rt = new AresRuntime({
    source: process.env,
    env: { mode: 'offline', DATA_DIR: dir, ARES_INSTANCE_ID: instance, STORAGE_DRIVER: 'supabase', storageDriver: 'supabase' },
  });
  runtimes.push(rt);
  return rt;
}

const plain = (s: SessionState) => JSON.parse(JSON.stringify(s)) as SessionState;

afterAll(async () => {
  // Stop every runtime first (even after a failed assertion), or a lease heartbeat re-creates rows after the cleanup.
  for (const rt of runtimes) await rt.dispose().catch(() => undefined);
  if (configured) {
    const sb = createSupabaseAdmin(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
    await sb.from('ares_instances').delete().in('instance_id', instances);
    await sb.from('ares_sessions').delete().in('instance_id', instances); // children cascade
  }
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!configured)('Supabase persistence (real project, throwaway instance)', () => {
  it('a full run (baseline + event) survives a restart byte-for-byte, with every message in the database', async () => {
    const instance = newInstance();
    const rt = runtime(instance);
    await rt.ready();
    expect(rt.persistence.driver).toBe('supabase');
    await runBaseline(rt);
    const before = plain(await injectPreset(rt, 'PRACTICE_ROVER'));
    expect(await rt.persistence.flushNow(60_000)).toBe(true);
    expect(rt.persistence.status()).toMatchObject({ state: 'SYNCED', pendingRows: 0, lastError: null });
    await rt.dispose();

    const rt2 = runtime(instance);
    await rt2.ready();
    const after = plain(rt2.getSnapshot());
    expect(after.id).toBe(before.id);
    expect(after).toEqual(before);

    expect(await rt2.persistence.refreshDbMessageCount(after.id)).toBe(before.messages.length);
    const counts = await rt2.persistence.deepCounts(after.id);
    expect(counts?.ares_messages).toBe(before.messages.length);
    expect(counts?.ares_plans).toBe(before.plans.length);
    expect(counts?.ares_votes).toBe(before.plans.reduce((n, p) => n + p.votes.length, 0));
    expect(counts?.ares_commitments).toBe(before.commitments.length);
    expect((await rt2.listSessions()).some((e) => e.id === before.id)).toBe(true);
    await rt2.dispose();
  });

  it('reset archives in the database and a fresh runtime follows the new current session', async () => {
    const instance = newInstance();
    const rt = runtime(instance);
    await rt.ready();
    const old = rt.getSnapshot().id;
    await runBaseline(rt);
    const { sessionId } = await rt.reset();
    expect(await rt.persistence.flushNow(60_000)).toBe(true);
    await rt.dispose();

    const rt2 = runtime(instance);
    await rt2.ready();
    expect(rt2.getSnapshot().id).toBe(sessionId);
    const list = await rt2.listSessions();
    expect(list.find((e) => e.id === old)?.status).toBe('archived');
    const archived = await rt2.getSession(old);
    expect(archived?.scenarios[0]?.outcome).toBe('APPROVED');
    await rt2.dispose();
  });
  it('search and insights functions work across two sessions of one instance', async () => {
    const instance = newInstance();
    const rt = runtime(instance);
    await rt.ready();
    await runBaseline(rt);
    await rt.reset(); // archives session 1, opens session 2
    await runBaseline(rt);
    expect(await rt.persistence.flushNow(60_000)).toBe(true);

    const state = rt.getSnapshot();
    const refusals = state.messages.filter((m) => m.subtype === 'SACRIFICE_REFUSAL').length;
    const found = await rt.search('refuse', 100);
    expect(found.source).toBe('supabase');
    expect(new Set(found.hits.map((h) => h.sessionId)).size).toBe(2); // both sessions
    expect(found.hits.every((h) => h.headline.length > 0)).toBe(true);
    expect(found.hits.some((h) => h.isCurrentSession)).toBe(true);
    expect(found.hits.filter((h) => h.subtype === 'SACRIFICE_REFUSAL' && h.isCurrentSession).length).toBeGreaterThanOrEqual(Math.min(1, refusals));

    const ins = await rt.insights();
    expect(ins.sessions).toBe(2);
    expect(ins.scenarios_by_outcome.APPROVED).toBe(2);
    expect(Object.values(ins.refusals_by_department).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(refusals);

    // The browser role must not be able to call them.
    const anon = createSupabaseAdmin(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY ?? 'invalid');
    const denied = await anon.rpc('ares_search_messages', { p_query: 'refuse', p_instance: instance, p_limit: 5 });
    expect(denied.error).not.toBeNull();
    await rt.dispose();
  });
});
