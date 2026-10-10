import 'server-only';
import type { DbTable, SessionState, StorageStatus } from '@/domain/types';
import { logger } from '../logger';
import { classifyDbError, DbError, type ClassifiedDbError } from './errors';
import { allKeys, rowsFor } from './mappers';
import { APPEND_ONLY, FLUSH_ORDER, ON_CONFLICT, type AnyRow } from './rows';

const log = logger('db-sync');
const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000];
const CHUNK = 500;

export interface SyncNotice {
  level: 'info' | 'warning' | 'error' | 'success';
  text: string;
}

export interface SyncOptions {
  instanceId: string;
  flushMs: number;
  timeoutMs: number;
  project: string | null;
  leaseOwner: string;
  onNotice?: (notice: SyncNotice) => void;
}

/** Minimal surface of the Supabase client the sync needs (lets tests inject a fake). */
export interface UpsertClient {
  from(table: string): {
    upsert(rows: AnyRow[], options: { onConflict: string; ignoreDuplicates: boolean }): {
      abortSignal(signal: AbortSignal): PromiseLike<{ error: unknown; status: number }>;
    };
  };
}

/**
 * Write-behind sync to Supabase. Mutations mark rows dirty (O(1)); a flush loop upserts them in FK order,
 * built from the CURRENT state so repeated changes coalesce. Nothing in the negotiation path awaits this.
 */
export class SupabaseSync {
  private dirty = new Map<DbTable, Map<string, number>>();
  private staticRows = new Map<string, { table: DbTable; row: AnyRow }>();
  private generation = 0;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private backoffIndex = 0;
  private retryAt = 0;
  private leaseTimer: NodeJS.Timeout | null = null;
  private faultCheck: () => boolean = () => false;
  private stopped = false;
  private readonly status: StorageStatus;

  constructor(
    private readonly client: UpsertClient,
    private readonly getState: () => SessionState | null,
    private readonly opts: SyncOptions,
  ) {
    this.status = {
      driver: 'supabase',
      state: 'SYNCED',
      instanceId: opts.instanceId,
      project: opts.project,
      pendingRows: 0,
      lastSyncAt: null,
      lastError: null,
      rowsWritten: {},
      dbMessageCount: null,
      leaseWarning: null,
    };
  }

  /** Phase 3 Resilience Lab: simulate a database outage. */
  setFaultCheck(check: () => boolean): void {
    this.faultCheck = check;
  }

  getStatus(): StorageStatus {
    return { ...this.status, pendingRows: this.pending(), rowsWritten: { ...this.status.rowsWritten } };
  }

  setDbMessageCount(count: number | null): void {
    this.status.dbMessageCount = count;
  }

  setLeaseWarning(warning: string | null): void {
    this.status.leaseWarning = warning;
  }

  pending(): number {
    let n = this.staticRows.size;
    for (const keys of this.dirty.values()) n += keys.size;
    return n;
  }

  markDirty(table: DbTable, key: string): void {
    if (this.stopped) return;
    let keys = this.dirty.get(table);
    if (!keys) this.dirty.set(table, (keys = new Map()));
    keys.set(key, ++this.generation);
    if (this.status.state === 'SYNCED') this.status.state = 'SYNCING';
    this.schedule(this.opts.flushMs);
  }

  markAllDirty(state: SessionState): void {
    const keys = allKeys(state);
    for (const table of FLUSH_ORDER) for (const key of keys[table]) this.markDirty(table, key);
  }

  /** Rows that are not derived from the current state (e.g. the final row of an archived session). */
  enqueueStatic(table: DbTable, key: string, row: AnyRow): void {
    this.staticRows.set(`${table}:${key}`, { table, row });
    this.schedule(this.opts.flushMs);
  }

  startLease(): void {
    const beat = () => {
      const state = this.getState();
      if (state) this.markDirty('ares_instances', state.instanceId);
    };
    beat();
    this.leaseTimer = setInterval(beat, 10_000);
    this.leaseTimer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.leaseTimer) clearInterval(this.leaseTimer);
  }

  private schedule(delay: number): void {
    if (this.timer || this.stopped) return;
    const wait = Math.max(delay, this.retryAt - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, wait);
    this.timer.unref?.();
  }

  private reschedule(delay: number): void {
    this.retryAt = Date.now() + delay;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.schedule(delay);
  }

  /** Best-effort awaited flush (reset, export, shutdown, tests). */
  async flushNow(timeoutMs = 5000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await this.flush();
      if (this.pending() === 0) return true;
      if (this.status.state === 'ERROR') return false;
      await new Promise((r) => setTimeout(r, Math.min(250, Math.max(0, deadline - Date.now()))));
    }
    return this.pending() === 0;
  }

  flush(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (this.pending() === 0) return Promise.resolve();
    this.inFlight = this.flushOnce().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async flushOnce(): Promise<void> {
    try {
      if (this.faultCheck()) throw new DbError(classifyDbError({ message: 'TypeError: fetch failed (simulated database outage)' }));
      // 1) static rows first (archived sessions etc.), then dirty rows in FK order
      for (const [key, { table, row }] of [...this.staticRows]) {
        await this.write(table, [row]);
        this.staticRows.delete(key);
      }
      const state = this.getState();
      if (state) {
        for (const table of FLUSH_ORDER) {
          const keys = this.dirty.get(table);
          if (!keys || keys.size === 0) continue;
          const snapshot = [...keys.entries()];
          const rows = rowsFor(table, snapshot.map(([k]) => k), state, this.opts.leaseOwner);
          for (let i = 0; i < rows.length; i += CHUNK) await this.write(table, rows.slice(i, i + CHUNK));
          for (const [key, gen] of snapshot) if (keys.get(key) === gen) keys.delete(key);
        }
      }
      this.onSuccess();
    } catch (err) {
      this.onFailure(err);
    }
  }

  private async write(table: DbTable, rows: AnyRow[]): Promise<void> {
    if (rows.length === 0) return;
    const { error, status } = await this.client
      .from(table)
      .upsert(rows, { onConflict: ON_CONFLICT[table], ignoreDuplicates: APPEND_ONLY.has(table) })
      .abortSignal(AbortSignal.timeout(this.opts.timeoutMs));
    if (!error) {
      this.status.rowsWritten[table] = (this.status.rowsWritten[table] ?? 0) + rows.length;
      return;
    }
    const classified = classifyDbError(error, status);
    if (classified.kind === 'DATA' && rows.length > 1) {
      // isolate the offending row(s): write one by one, skip the ones that violate a constraint
      for (const row of rows) await this.write(table, [row]);
      return;
    }
    if (classified.kind === 'DATA') {
      log.error(`skipped a ${table} row that violates a constraint`, { code: classified.code, message: classified.message });
      this.opts.onNotice?.({ level: 'error', text: `Database rejected one ${table} row (${classified.code}); it was skipped and logged.` });
      return;
    }
    throw new DbError(classified, table);
  }

  private onSuccess(): void {
    const recovered = this.status.state === 'DEGRADED' || this.status.state === 'ERROR';
    this.backoffIndex = 0;
    this.retryAt = 0;
    this.status.lastSyncAt = new Date().toISOString();
    this.status.lastError = null;
    this.status.state = this.pending() === 0 ? 'SYNCED' : 'SYNCING';
    if (recovered) this.opts.onNotice?.({ level: 'success', text: 'Database restored — buffered rows synced to Supabase.' });
    if (this.pending() > 0) this.schedule(this.opts.flushMs);
  }

  private onFailure(err: unknown): void {
    const classified: ClassifiedDbError = err instanceof DbError ? err.classified : classifyDbError(err);
    const previous = this.status.state;
    this.status.lastError = { code: classified.code, message: classified.message.slice(0, 300), hint: classified.hint };
    if (classified.kind === 'CONFIG') {
      this.status.state = 'ERROR';
      if (previous !== 'ERROR') {
        log.error('database configuration error', { code: classified.code, hint: classified.hint });
        this.opts.onNotice?.({ level: 'error', text: `Database error (${classified.code}): ${classified.hint}` });
      }
      this.reschedule(30_000); // re-probe
      return;
    }
    this.status.state = 'DEGRADED';
    if (previous !== 'DEGRADED') {
      log.warn('database unreachable; buffering writes', { code: classified.code, message: classified.message.slice(0, 120) });
      this.opts.onNotice?.({ level: 'warning', text: 'Database unreachable — writes are buffered and retried; the local snapshot is safe.' });
    }
    const delay = BACKOFF_MS[Math.min(this.backoffIndex, BACKOFF_MS.length - 1)]!;
    this.backoffIndex++;
    this.reschedule(delay);
  }
}
