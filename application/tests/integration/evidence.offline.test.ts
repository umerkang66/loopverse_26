import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { buildEvidence } from '@/server/export';
import { injectPreset, offlineRuntime, runBaseline } from './helpers';

describe('evidence pack (offline run)', () => {
  let cleanup: (() => Promise<void>) | null = null;
  afterEach(async () => void (await cleanup?.()));

  it('contains every file, hashes match, and the narrative covers the event', async () => {
    const o = await offlineRuntime({ HITL_ENABLED: false });
    cleanup = o.cleanup;
    await runBaseline(o.rt);
    await injectPreset(o.rt, 'PRACTICE_ROVER');
    const { body, filename, manifest } = await buildEvidence(o.rt);
    expect(filename).toMatch(/^ares-accord-evidence-[0-9a-f]{8}\.zip$/);

    const files = unzipSync(body);
    const names = Object.keys(files).sort();
    for (const required of [
      'final_allocation.json', 'council_transcript.json', 'council_transcript.csv', 'opening_negotiation_log.json', 'opening_negotiation_log.md',
      'post_event_log.json', 'post_event_log.md', 'crisis_handling_log.txt', 'final_plan_S0.json', 'final_plan_S1.json', 'plans.csv', 'votes.csv',
      'commitments.csv', 'compliance_report.json', 'manifest.json', 'README.txt',
    ]) expect(names).toContain(required);

    const m = JSON.parse(strFromU8(files['manifest.json']!)) as typeof manifest & { sha256: Record<string, string> };
    for (const [name, hash] of Object.entries(m.sha256)) expect(createHash('sha256').update(files[name]!).digest('hex')).toBe(hash);
    expect(m.messageCounts).toMatchObject({ LLM: 0 });
    expect((m.messageCounts as { FALLBACK: number }).FALLBACK).toBeGreaterThan(0); // offline agents stay labeled
    expect(m.storage).toMatchObject({ driver: 'file', parity: null });

    const transcript = JSON.parse(strFromU8(files['council_transcript.json']!)) as { scenarioId: string; source: string }[];
    expect(new Set(transcript.map((t) => t.scenarioId))).toEqual(new Set(['S0', 'S1']));
    expect(transcript.every((t) => t.source)).toBe(true);

    const log = strFromU8(files['crisis_handling_log.txt']!);
    expect(log).toContain('S1  EVENT');
    expect(log).toMatch(/Plan in force v\d+ → (INVALID|STALE)/);
    expect(log).toMatch(/APPROVED v\d+ in round \d+ · 4\/4 ACCEPT/);
    const final = JSON.parse(strFromU8(files['final_allocation.json']!)) as { per_scenario: Record<string, unknown> };
    expect(Object.keys(final.per_scenario)).toEqual(['S0', 'S1']);
  });
});
