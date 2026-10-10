import { describe, expect, it, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { SessionState } from '@/domain/types';
import { offlineRuntime, runBaseline, injectPreset } from '../../../tests/integration/helpers';
import { fromRows, toRows } from './mappers';
import { FLUSH_ORDER, type AnyRow } from './rows';
import { SupabaseSync, type UpsertClient } from './sync';
import { LocalSnapshot } from '../store/local-snapshot';

let fixture: SessionState;
const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const c of cleanups) await c();
});

async function getFixture(): Promise<SessionState> {
  if (fixture) return fixture;
  const h = await offlineRuntime();
  cleanups.push(h.cleanup);
  await runBaseline(h.rt);
  fixture = structuredClone(await injectPreset(h.rt, 'PRACTICE_ROVER'));
  return fixture;
}

class FakeClient implements UpsertClient {
  calls: { table: string; rows: AnyRow[]; onConflict: string; ignoreDuplicates: boolean }[] = [];
  fail: { error: { code: string; message: string }; status: number } | null = null;
  gate: Promise<void> | null = null;
  from(table: string) {
    return {
      upsert: (rows: AnyRow[], options: { onConflict: string; ignoreDuplicates: boolean }) => ({
        abortSignal: async () => {
          if (this.gate) await this.gate;
          if (this.fail) return this.fail;
          this.calls.push({ table, rows, ...options });
          return { error: null, status: 201 };
        },
      }),
    };
  }
}

const sync = (client: FakeClient, state: () => SessionState) =>
  new SupabaseSync(client, state, { instanceId: 'test', flushMs: 5, timeoutMs: 1000, project: 'x.supabase.co', leaseOwner: 'me' });

describe('row mappers', () => {
  it('round-trips a full session (baseline + event) through JSON rows', async () => {
    const s = await getFixture();
    const rows = JSON.parse(JSON.stringify(toRows(s)));
    const { ares_instances: _instances, ...rest } = rows;
    const back = fromRows(rest);
    expect(back).toEqual(JSON.parse(JSON.stringify(s)));
  });
});

describe('write-behind sync', () => {
  it('flushes in foreign-key order with idempotent append-only upserts', async () => {
    const s = await getFixture();
    const client = new FakeClient();
    const sy = sync(client, () => s);
    sy.markAllDirty(s);
    expect(await sy.flushNow(2000)).toBe(true);
    const order = [...new Set(client.calls.map((c) => c.table))];
    expect(order).toEqual(FLUSH_ORDER.filter((t) => order.includes(t)));
    expect(client.calls.find((c) => c.table === 'ares_messages')!.ignoreDuplicates).toBe(true);
    expect(client.calls.find((c) => c.table === 'ares_plans')!.ignoreDuplicates).toBe(false);
    expect(client.calls.find((c) => c.table === 'ares_plans')!.onConflict).toBe('session_id,version');
    expect(sy.getStatus().state).toBe('SYNCED');
    sy.stop();
  });

  it('coalesces repeated changes into one row and chunks large tables (≤ 500 rows)', async () => {
    const s = structuredClone(await getFixture());
    const base = s.messages[0]!;
    for (let i = 0; i < 1100; i++) s.messages.push({ ...base, seq: 10_000 + i, id: `M-X${i}` });
    const client = new FakeClient();
    const sy = sync(client, () => s);
    for (let i = 0; i < 5; i++) sy.markDirty('ares_plans', String(s.plans[0]!.version));
    for (const m of s.messages.slice(-1100)) sy.markDirty('ares_messages', String(m.seq));
    await sy.flushNow(2000);
    expect(client.calls.filter((c) => c.table === 'ares_plans').reduce((n, c) => n + c.rows.length, 0)).toBe(1);
    const chunks = client.calls.filter((c) => c.table === 'ares_messages').map((c) => c.rows.length);
    expect(chunks).toEqual([500, 500, 100]);
    sy.stop();
  });

  it('missing GRANT → ERROR with an actionable hint, keeps the rows, recovers to SYNCED', async () => {
    const s = await getFixture();
    const client = new FakeClient();
    client.fail = { error: { code: '42501', message: 'permission denied for table ares_sessions' }, status: 401 };
    const sy = sync(client, () => s);
    sy.markDirty('ares_sessions', s.id);
    await sy.flush();
    const st = sy.getStatus();
    expect(st.state).toBe('ERROR');
    expect(st.lastError?.hint).toContain('GRANT');
    expect(st.pendingRows).toBeGreaterThan(0);
    client.fail = null;
    await sy.flushNow(2000);
    expect(sy.getStatus().state).toBe('SYNCED');
    sy.stop();
  });

  it('network failure → DEGRADED (buffered), then recovery', async () => {
    const s = await getFixture();
    const client = new FakeClient();
    client.fail = { error: { code: '', message: 'TypeError: fetch failed' }, status: 0 };
    const sy = sync(client, () => s);
    sy.markDirty('ares_sessions', s.id);
    await sy.flush();
    expect(sy.getStatus().state).toBe('DEGRADED');
    client.fail = null;
    await sy.flush();
    expect(sy.getStatus().state).toBe('SYNCED');
    sy.stop();
  });

  it('a row changed while its upsert is in flight stays dirty (generation-safe clearing)', async () => {
    const s = await getFixture();
    const client = new FakeClient();
    let release!: () => void;
    client.gate = new Promise<void>((r) => (release = r));
    const sy = sync(client, () => s);
    const key = String(s.plans[0]!.version);
    sy.markDirty('ares_plans', key);
    const inflight = sy.flush();
    sy.markDirty('ares_plans', key);
    release();
    await inflight;
    expect(sy.pending()).toBe(1);
    client.gate = null;
    await sy.flushNow(2000);
    expect(sy.pending()).toBe(0);
    sy.stop();
  });

  it('the simulated database outage (Resilience Lab hook) buffers and then syncs', async () => {
    const s = await getFixture();
    const client = new FakeClient();
    const sy = sync(client, () => s);
    let outage = true;
    sy.setFaultCheck(() => outage);
    sy.markDirty('ares_sessions', s.id);
    await sy.flush();
    expect(sy.getStatus().state).toBe('DEGRADED');
    outage = false;
    await sy.flush();
    expect(sy.getStatus().state).toBe('SYNCED');
    sy.stop();
  });
});

describe('local snapshot', () => {
  it('writes atomically and falls back to the .bak copy when current.json is corrupt', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ares-snap-'));
    const s = await getFixture();
    const snap = new LocalSnapshot(dir, 'test', 1);
    snap.schedule(() => s);
    await snap.flush();
    snap.schedule(() => ({ ...s, updatedAt: '2030-01-01T00:00:00.000Z' }));
    await snap.flush();
    writeFileSync(snap.currentFile, '{corrupt');
    const loaded = await snap.load();
    expect(loaded?.id).toBe(s.id);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('instance lease', () => {
  it('treats a lease held by a dead process on this machine as stale (crash restart), never a live one', async () => {
    const { deadLocalOwner } = await import('../store/persistence');
    const host = (await import('node:os')).hostname();
    expect(deadLocalOwner(`${host}:${process.pid}:abc`)).toBe(false); // this process
    expect(deadLocalOwner(`${host}:${process.ppid}:abc`)).toBe(false); // alive
    expect(deadLocalOwner(`${host}:2147483646:abc`)).toBe(true); // no such pid
    expect(deadLocalOwner(`another-host:2147483646:abc`)).toBe(false); // cannot tell: keep the warning
  });
});
