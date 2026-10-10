import type { Model } from '@openai/agents';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AresRuntime } from '@/server/runtime';
import type { ServerEnv } from '@/server/env';
import { EVENT_PRESETS } from '@/domain/scenario';
import type { SessionState } from '@/domain/types';

export async function offlineRuntime(env: Partial<ServerEnv> = {}, intakeModel?: Model): Promise<{ rt: AresRuntime; dir: string; cleanup: () => Promise<void> }> {
  const dir = mkdtempSync(path.join(tmpdir(), 'ares-test-'));
  const rt = new AresRuntime({
    intakeModel,
    source: {},
    env: { mode: 'offline', storageDriver: 'file', STORAGE_DRIVER: 'file', DATA_DIR: dir, ARES_INSTANCE_ID: 'test', ...env },
  });
  await rt.ready();
  return {
    rt,
    dir,
    cleanup: async () => {
      await rt.dispose();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function runBaseline(rt: AresRuntime, resources?: unknown): Promise<SessionState> {
  await rt.start(resources === undefined ? {} : { resources });
  await rt.waitForIdle();
  return rt.getSnapshot();
}

export async function injectPreset(rt: AresRuntime, presetId: string): Promise<SessionState> {
  const preset = EVENT_PRESETS.find((p) => p.id === presetId);
  if (!preset) throw new Error(`no preset ${presetId}`);
  const { interpretation } = await rt.interpretEvent({ kind: 'preset', presetId });
  await rt.applyEvent(interpretation);
  await rt.waitForIdle();
  return rt.getSnapshot();
}

export const keyOf = (s: SessionState, version: number | null) => {
  const p = s.plans.find((x) => x.version === version);
  return p ? `${p.selections.LIFE_SUPPORT}+${p.selections.MEDICAL}+${p.selections.FOOD}+${p.selections.ENGINEERING}` : null;
};
