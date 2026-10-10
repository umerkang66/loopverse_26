import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SessionState } from '@/domain/types';
import { logger } from '../logger';
import { sessionSummary, type SessionListEntry } from './summary';

const log = logger('snapshot');
const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Write-to-temp then rename (atomic), retrying the transient locks Windows produces. Keeps a .bak copy. */
export async function atomicWrite(file: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, data, 'utf8');
  try {
    await fs.copyFile(file, `${file}.bak`);
  } catch {
    // first write: nothing to back up
  }
  for (let attempt = 1; ; attempt++) {
    try {
      await fs.rename(tmp, file);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (!RETRYABLE.has(code) || attempt >= 6) {
        await fs.rm(tmp, { force: true });
        throw err;
      }
      await sleep(25 * attempt);
    }
  }
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/**
 * The always-on local copy of the current session (crash buffer, and the whole store in file mode).
 * In file mode it also keeps the archive of past sessions.
 */
export class LocalSnapshot {
  readonly dir: string;
  private timer: NodeJS.Timeout | null = null;
  private source: (() => SessionState | null) | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(dataDir: string, instanceId: string, private readonly debounceMs = 1000) {
    this.dir = path.resolve(dataDir, instanceId);
  }

  get currentFile(): string {
    return path.join(this.dir, 'current.json');
  }

  schedule(source: () => SessionState | null): void {
    this.source = source;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
    this.timer.unref?.();
  }

  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const source = this.source;
    this.source = null;
    if (!source) return this.chain;
    const state = source();
    if (!state) return this.chain;
    const json = JSON.stringify(state);
    this.chain = this.chain
      .then(() => atomicWrite(this.currentFile, json))
      .catch((err) => log.error('snapshot write failed', err));
    return this.chain;
  }

  async load(): Promise<SessionState | null> {
    return (await readJson<SessionState>(this.currentFile)) ?? (await readJson<SessionState>(`${this.currentFile}.bak`));
  }

  // ── file-mode archive ──
  private get indexFile() {
    return path.join(this.dir, 'index.json');
  }

  async archive(state: SessionState): Promise<void> {
    await atomicWrite(path.join(this.dir, 'sessions', `${state.id}.json`), JSON.stringify(state));
    const index = (await readJson<SessionListEntry[]>(this.indexFile)) ?? [];
    const entry: SessionListEntry = {
      id: state.id,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      status: 'archived',
      summary: sessionSummary(state),
    };
    await atomicWrite(this.indexFile, JSON.stringify([entry, ...index.filter((e) => e.id !== state.id)].slice(0, 200)));
  }

  async list(): Promise<SessionListEntry[]> {
    return (await readJson<SessionListEntry[]>(this.indexFile)) ?? [];
  }

  async get(id: string): Promise<SessionState | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    return readJson<SessionState>(path.join(this.dir, 'sessions', `${id}.json`));
  }

  async deleteAll(): Promise<void> {
    await this.flush();
    await fs.rm(this.dir, { recursive: true, force: true });
  }
}
