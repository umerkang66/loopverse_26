import 'server-only';
import os from 'node:os';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { InsightsResponse, SearchResponse } from '@/domain/api';
import type { DbTable, SessionState, StorageStatus } from '@/domain/types';
import type { ServerEnv } from '../env';
import { newSessionId } from '../ids';
import { logger } from '../logger';
import { DbError } from '../db/errors';
import {
  countMessages,
  deleteInstanceSessions,
  headCounts,
  listSessionsFromDb,
  loadSessionFromDb,
  readInstance,
} from '../db/load';
import { sessionRow } from '../db/mappers';
import { getSupabaseAdmin } from '../db/supabase';
import { SupabaseSync, type SyncNotice, type UpsertClient } from '../db/sync';
import { insightsFromSessions, insightsRemote, searchRemote, searchSessions } from '../search';
import { LocalSnapshot } from './local-snapshot';
import type { SessionListEntry } from './summary';

const log = logger('persistence');

/** A lease owner ("host:pid:boot") from this machine whose process no longer exists: a crashed or stopped runtime. */
export function deadLocalOwner(owner: string): boolean {
  const [host, pidText] = owner.split(':');
  const pid = Number(pidText);
  if (host !== os.hostname() || !Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0); // signal 0 only tests for existence (works on Windows too)
    return false;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

export interface BootResult {
  state: SessionState;
  restoredFrom: 'supabase' | 'local' | 'new';
  notes: string[];
}

/**
 * Supabase Postgres is the system of record (write-behind sync); the local snapshot is the crash buffer
 * and, without Supabase credentials, the whole store.
 */
export class Persistence {
  readonly driver: 'supabase' | 'file';
  readonly snapshot: LocalSnapshot;
  readonly sync: SupabaseSync | null;
  private readonly sb: SupabaseClient | null;
  private readonly leaseOwner = `${os.hostname()}:${process.pid}:${newSessionId().slice(-8)}`;
  private countCache: { sessionId: string; at: number; value: number } | null = null;

  constructor(
    private readonly env: ServerEnv,
    private readonly getState: () => SessionState | null,
    onNotice: (notice: SyncNotice) => void = () => {},
    client?: SupabaseClient | null,
  ) {
    this.driver = env.storageDriver;
    this.snapshot = new LocalSnapshot(env.DATA_DIR, env.ARES_INSTANCE_ID);
    this.sb = client !== undefined ? client : getSupabaseAdmin(env);
    this.sync =
      this.driver === 'supabase' && this.sb
        ? new SupabaseSync(this.sb as unknown as UpsertClient, getState, {
            instanceId: env.ARES_INSTANCE_ID,
            flushMs: env.DB_FLUSH_MS,
            timeoutMs: env.DB_TIMEOUT_MS,
            project: env.supabaseHost,
            leaseOwner: this.leaseOwner,
            onNotice,
          })
        : null;
  }

  async boot(createNew: () => SessionState): Promise<BootResult> {
    const notes: string[] = [];
    const local = await this.snapshot.load();
    let remote: SessionState | null = null;
    let dbReachable = this.driver === 'supabase';
    if (this.sb && this.sync) {
      try {
        const instance = await readInstance(this.sb, this.env.ARES_INSTANCE_ID, this.env.DB_TIMEOUT_MS);
        if (instance?.lease_owner && instance.lease_owner !== this.leaseOwner && instance.lease_expires_at && Date.parse(instance.lease_expires_at) > Date.now()) {
          if (deadLocalOwner(instance.lease_owner)) {
            notes.push(`Taking over instance '${this.env.ARES_INSTANCE_ID}' from a stopped runtime (${instance.lease_owner}).`);
          } else {
            const warning = `Another runtime (${instance.lease_owner}) is writing instance '${this.env.ARES_INSTANCE_ID}' — set a different ARES_INSTANCE_ID.`;
            this.sync.setLeaseWarning(warning);
            notes.push(warning);
            this.recheckLease(Date.parse(instance.lease_expires_at) - Date.now() + 2_000);
          }
        }
        if (instance?.current_session_id) remote = await loadSessionFromDb(this.sb, instance.current_session_id, this.env.DB_TIMEOUT_MS);
      } catch (err) {
        dbReachable = false;
        const hint = err instanceof DbError ? err.classified.hint : String(err);
        notes.push(`Supabase unavailable at boot: ${hint}`);
        log.warn('Supabase unavailable at boot; starting from the local snapshot', hint);
      }
    }

    let state: SessionState;
    let restoredFrom: BootResult['restoredFrom'];
    if (remote && (!local || Date.parse(remote.updatedAt) >= Date.parse(local.updatedAt))) {
      state = remote;
      restoredFrom = 'supabase';
    } else if (local) {
      state = local;
      restoredFrom = 'local';
      if (this.sync) notes.push(remote ? 'Local snapshot is newer than Supabase; resyncing.' : 'Pushing the local snapshot to Supabase.');
    } else {
      state = createNew();
      restoredFrom = 'new';
    }
    if (state.instanceId !== this.env.ARES_INSTANCE_ID) state = { ...state, instanceId: this.env.ARES_INSTANCE_ID };
    return { state, restoredFrom, notes: dbReachable || !this.sync ? notes : [...notes, 'Running DEGRADED until Supabase is reachable.'] };
  }

  /** After the other lease should have expired: clear the warning unless that runtime renewed it (a real conflict). */
  private recheckLease(delayMs: number): void {
    const timer = setTimeout(async () => {
      if (!this.sb || !this.sync) return;
      const row = await readInstance(this.sb, this.env.ARES_INSTANCE_ID, this.env.DB_TIMEOUT_MS).catch(() => null);
      if (!row) return;
      const foreignActive = row.lease_owner !== this.leaseOwner && row.lease_expires_at !== null && Date.parse(row.lease_expires_at) > Date.now();
      if (!foreignActive) this.sync.setLeaseWarning(null);
    }, Math.max(1_000, delayMs));
    timer.unref?.();
  }

  /** Called once the runtime holds the booted state. */
  start(restoredFrom: BootResult['restoredFrom']): void {
    const state = this.getState();
    if (!state || !this.sync) return;
    if (restoredFrom !== 'supabase') this.sync.markAllDirty(state);
    this.sync.startLease();
  }

  markDirty(table: DbTable, key: string): void {
    this.sync?.markDirty(table, key);
  }

  markAllDirty(): void {
    const state = this.getState();
    if (state) this.sync?.markAllDirty(state);
  }

  scheduleSnapshot(): void {
    this.snapshot.schedule(this.getState);
  }

  /** Writes the snapshot and drains the database queue; true when nothing is left pending. */
  async flushNow(timeoutMs = 5000): Promise<boolean> {
    this.snapshot.schedule(this.getState);
    const [, synced] = await Promise.all([this.snapshot.flush(), this.sync ? this.sync.flushNow(timeoutMs) : Promise.resolve(true)]);
    return synced;
  }

  status(): StorageStatus {
    if (this.sync) return this.sync.getStatus();
    return {
      driver: 'file',
      state: 'LOCAL_ONLY',
      instanceId: this.env.ARES_INSTANCE_ID,
      project: null,
      pendingRows: 0,
      lastSyncAt: null,
      lastError: null,
      rowsWritten: {},
      dbMessageCount: null,
      leaseWarning: null,
    };
  }

  /** Archive the outgoing session (history is never deleted by a normal reset). */
  async archive(old: SessionState): Promise<void> {
    if (this.sync) {
      await this.sync.flushNow(5000);
      this.sync.enqueueStatic('ares_sessions', old.id, sessionRow(old, 'archived'));
    } else {
      await this.snapshot.archive(old);
    }
  }

  async listSessions(limit = 50): Promise<SessionListEntry[]> {
    if (this.sb && this.sync) return listSessionsFromDb(this.sb, this.env.ARES_INSTANCE_ID, limit, this.env.DB_TIMEOUT_MS);
    return (await this.snapshot.list()).slice(0, limit);
  }

  async getSession(id: string): Promise<SessionState | null> {
    if (this.sb && this.sync) {
      const s = await loadSessionFromDb(this.sb, id, this.env.DB_TIMEOUT_MS);
      return s && s.instanceId === this.env.ARES_INSTANCE_ID ? s : null;
    }
    return this.snapshot.get(id);
  }

  private async localSessions(current: SessionState | null): Promise<SessionState[]> {
    const out: SessionState[] = current ? [current] : [];
    for (const entry of (await this.snapshot.list()).slice(0, 100)) {
      if (entry.id === current?.id) continue;
      const s = await this.snapshot.get(entry.id);
      if (s) out.push(s);
    }
    return out;
  }

  /** Ranked full-text search across every session of this instance (Supabase), or the local archive in file mode. */
  async search(query: string, limit: number, current: SessionState | null): Promise<SearchResponse> {
    const currentId = current?.id ?? '';
    if (this.sb && this.sync) {
      await this.sync.flushNow(2000).catch(() => false);
      try {
        return { query, source: 'supabase', hits: await searchRemote(this.sb, this.env.ARES_INSTANCE_ID, query, limit, currentId, this.env.DB_TIMEOUT_MS) };
      } catch (err) {
        log.warn('database search failed; searching the local archive instead', err instanceof Error ? err.message : String(err));
      }
    }
    return { query, source: 'local', hits: searchSessions(await this.localSessions(current), currentId, query, limit) };
  }

  async insights(current: SessionState | null): Promise<InsightsResponse> {
    if (this.sb && this.sync) {
      await this.sync.flushNow(2000).catch(() => false);
      try {
        return await insightsRemote(this.sb, this.env.ARES_INSTANCE_ID, this.env.DB_TIMEOUT_MS);
      } catch (err) {
        log.warn('database insights failed; computing from the local archive', err instanceof Error ? err.message : String(err));
      }
    }
    return insightsFromSessions(await this.localSessions(current));
  }

  async hardReset(): Promise<void> {
    if (this.sb && this.sync) await deleteInstanceSessions(this.sb, this.env.ARES_INSTANCE_ID, this.env.DB_TIMEOUT_MS);
    await this.snapshot.deleteAll();
  }

  async deepCounts(sessionId: string): Promise<Partial<Record<DbTable, number>> | null> {
    if (!this.sb || !this.sync) return null;
    return headCounts(this.sb, sessionId, this.env.DB_TIMEOUT_MS);
  }

  /** Cached (10 s) DB message count for the PERSISTED compliance item. */
  async refreshDbMessageCount(sessionId: string): Promise<number | null> {
    if (!this.sb || !this.sync) return null;
    if (this.countCache && this.countCache.sessionId === sessionId && Date.now() - this.countCache.at < 10_000) return this.countCache.value;
    try {
      const value = await countMessages(this.sb, sessionId, this.env.DB_TIMEOUT_MS);
      this.countCache = { sessionId, at: Date.now(), value };
      this.sync.setDbMessageCount(value);
      return value;
    } catch {
      return null;
    }
  }

  stop(): void {
    this.sync?.stop();
  }
}
