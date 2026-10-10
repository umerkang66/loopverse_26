/**
 * Generates the official evidence pack and unpacks it into the evidence/ directory.
 * Usage:
 *   npx tsx scripts/generate-evidence.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { buildEvidence } from '../src/server/export';
import { AresRuntime } from '../src/server/runtime';

async function main() {
  console.log('Generating ARES ACCORD live evidence pack…');
  const rt = new AresRuntime({
    env: {
      DATA_DIR: path.join(process.cwd(), 'data', 'evidence-gen'),
      ARES_INSTANCE_ID: 'evidence-' + Date.now(),
      STORAGE_DRIVER: 'file',
      storageDriver: 'file',
      HITL_ENABLED: false,
    },
  });

  await rt.ready();
  console.log('Running S0 (Baseline council)…');
  await rt.start();
  await rt.waitForIdle(120_000);

  console.log('Injecting S1 crisis event (PRACTICE_ROVER)…');
  const { interpretation } = await rt.interpretEvent({
    kind: 'preset',
    presetId: 'PRACTICE_ROVER',
  });
  await rt.applyEvent(interpretation);
  await rt.waitForIdle(120_000);

  console.log('Packaging evidence pack (.zip)…');
  const { body, filename } = await buildEvidence(rt);
  const files = unzipSync(body);

  const rootEvidenceDir = path.resolve(process.cwd(), '..', 'evidence');
  const liveEvidenceDir = path.resolve(rootEvidenceDir, '2026-10-10-live');
  mkdirSync(rootEvidenceDir, { recursive: true });
  mkdirSync(liveEvidenceDir, { recursive: true });

  // Save the full zip in evidence
  writeFileSync(path.join(rootEvidenceDir, filename), body);
  console.log(`Saved ${filename} to evidence/`);

  // Unpack files into evidence/ and evidence/2026-10-10-live/
  for (const [name, u8] of Object.entries(files)) {
    writeFileSync(path.join(liveEvidenceDir, name), u8);
    // Top-level files required by organizers' checklist:
    if (
      [
        'final_allocation.json',
        'council_transcript.json',
        'crisis_handling_log.txt',
        'compliance_report.json',
        'opening_negotiation_log.md',
        'post_event_log.md',
        'manifest.json',
        'README.txt',
      ].includes(name)
    ) {
      writeFileSync(path.join(rootEvidenceDir, name), u8);
    }
  }

  console.log(
    '✓ All evidence files extracted successfully to evidence/ and evidence/2026-10-10-live/',
  );
  await rt.dispose();
}

main().catch(err => {
  console.error('Evidence generation failed:', err);
  process.exit(1);
});
