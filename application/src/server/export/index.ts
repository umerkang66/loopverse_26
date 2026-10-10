import 'server-only';
import type { ComplianceItem, SessionState } from '@/domain/types';
import { persistedItem } from '../public-state';
import { HttpError, type AresRuntime } from '../runtime';
import { CSV_KINDS, csvExport, type CsvKind } from './csv';
import { buildEvidenceZip, storageParity } from './evidence';
import { finalAllocation } from './final';
import { jsonExport } from './json';

export type ExportFormat = 'json' | 'csv' | 'final';

export interface ExportFile {
  body: string;
  contentType: string;
  filename: string;
}

function complianceExtra(rt: AresRuntime, s: SessionState, isCurrent: boolean): ComplianceItem[] {
  if (isCurrent) return [persistedItem(s, rt.persistence.status())];
  if (rt.persistence.driver !== 'supabase') return [];
  return [{ id: 'PERSISTED', label: 'Complete, persistent history of all scenarios', scope: 'SYSTEM', status: 'PASS', evidence: [], detail: 'Loaded from the Supabase archive' }];
}

/** Builds a download for the current session (from memory, after a flush) or an archived one (from storage). */
export async function buildExport(rt: AresRuntime, q: { format: ExportFormat; kind?: string | null; sessionId?: string | null; scenarioId?: string | null }): Promise<ExportFile> {
  let s: SessionState;
  try {
    s = await rt.exportSession(q.sessionId ?? undefined);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(503, 'The archive could not be read from storage. Try again in a moment.');
  }
  const isCurrent = s.id === rt.getSnapshot().id;
  const stem = `ares-accord-${s.id.slice(0, 8)}`;
  if (q.format === 'json') {
    return { body: JSON.stringify(jsonExport(s, complianceExtra(rt, s, isCurrent)), null, 2), contentType: 'application/json; charset=utf-8', filename: `${stem}.json` };
  }
  if (q.format === 'final') {
    const final = finalAllocation(s, q.scenarioId ?? undefined);
    if (!final) throw new HttpError(404, q.scenarioId ? `Scenario ${q.scenarioId} not found.` : 'No scenario has started yet.');
    return { body: JSON.stringify(final, null, 2), contentType: 'application/json; charset=utf-8', filename: 'final_allocation.json' };
  }
  const kind = (q.kind ?? 'transcript') as CsvKind;
  if (!CSV_KINDS.includes(kind)) throw new HttpError(400, `kind must be one of ${CSV_KINDS.join(', ')}`);
  return { body: csvExport(s, kind), contentType: 'text/csv; charset=utf-8', filename: `${stem}-${kind}.csv` };
}

/** The evidence pack (.zip): flushes storage first so the manifest's database row counts match the export. */
export async function buildEvidence(rt: AresRuntime, sessionId?: string | null): Promise<{ body: Uint8Array; filename: string; manifest: Record<string, unknown> }> {
  const s = await rt.exportSession(sessionId ?? undefined);
  const isCurrent = s.id === rt.getSnapshot().id;
  const counts = rt.persistence.driver === 'supabase' ? await rt.persistence.deepCounts(s.id).catch(() => null) : null;
  const status = rt.persistence.status();
  const { zip, manifest } = buildEvidenceZip(s, {
    mode: s.config.mode,
    models: s.config.models,
    appVersion: process.env.npm_package_version ?? '0.1.0',
    gitCommit: process.env.GIT_COMMIT?.trim() || null,
    extraCompliance: complianceExtra(rt, s, isCurrent),
    storage: {
      driver: rt.persistence.driver,
      project: status.project,
      instanceId: rt.env.ARES_INSTANCE_ID,
      rowCounts: counts,
      parity: storageParity(s, counts),
    },
  });
  return { body: zip, filename: `ares-accord-evidence-${s.id.slice(0, 8)}.zip`, manifest };
}
