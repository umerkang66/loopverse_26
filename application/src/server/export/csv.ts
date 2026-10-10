import 'server-only';
import { DEPARTMENT_IDS, RESOURCE_KEYS, type SessionState } from '@/domain/types';
import { tally } from '@/engine/votes';

export const CSV_KINDS = ['transcript', 'plans', 'votes', 'commitments'] as const;
export type CsvKind = (typeof CSV_KINDS)[number];

type Cell = string | number | boolean | null | undefined;

/** RFC 4180 field: quoted when needed, quotes doubled. Text that a spreadsheet would run as a formula is prefixed with '. */
export function csvField(value: Cell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows joined with CRLF (RFC 4180) behind a UTF-8 BOM so spreadsheet apps keep →, ·, ≤ intact. */
export function toCsv(header: readonly string[], rows: Cell[][]): string {
  return '﻿' + [header, ...rows].map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}

function transcript(s: SessionState): string {
  const header = ['seq', 'timestamp', 'scenario', 'round', 'phase', 'plan_version', 'from', 'to', 'type', 'subtype', 'summary', 'body', 'source', 'model', 'latency_ms', 'fallback_reason', 'trace_id'];
  const rows = s.messages.map((m) => [
    m.seq,
    m.createdAt,
    m.scenarioId,
    m.round,
    m.phase,
    m.planVersion,
    m.from,
    m.to === 'ALL' ? 'ALL' : m.to.join(';'),
    m.type,
    m.subtype,
    m.summary,
    m.body,
    m.source,
    m.meta?.model,
    m.meta?.latencyMs,
    m.meta?.fallbackReason,
    m.meta?.traceId,
  ]);
  return toCsv(header, rows);
}

function plans(s: SessionState): string {
  const header = ['version', 'scenario', 'round', 'status', ...DEPARTMENT_IDS, ...RESOURCE_KEYS, 'risk', 'sacrifices', 'validation', 'failed_checks', 'accept_votes', 'reject_votes', 'hash'];
  const rows = s.plans.map((p) => {
    const report = p.validations[p.validations.length - 1];
    const t = tally(p);
    return [
      p.version,
      p.scenarioId,
      p.round,
      p.status,
      ...DEPARTMENT_IDS.map((d) => p.selections[d]),
      ...RESOURCE_KEYS.map((k) => p.totals[k]),
      p.risk,
      p.sacrifices.join(';'),
      report ? `${report.status} (${report.stage})` : '',
      report ? report.checks.filter((c) => c.status === 'FAIL').map((c) => c.id).join(';') : '',
      t.accept,
      t.reject,
      p.hash,
    ];
  });
  return toCsv(header, rows);
}

function votes(s: SessionState): string {
  const header = ['vote_id', 'scenario', 'round', 'plan_version', 'plan_hash', 'agent', 'decision', 'reason', 'conditions_for_accept', 'source', 'created_at'];
  const rows = s.plans.flatMap((p) =>
    p.votes.map((v) => [v.id, p.scenarioId, v.round, v.planVersion, v.planHash, v.agentId, v.decision, v.reason, v.conditionsForAccept.join(' | '), v.source, v.createdAt]),
  );
  return toCsv(header, rows);
}

function commitments(s: SessionState): string {
  const header = ['id', 'scenario', 'round', 'owner', 'beneficiary', 'kind', 'resource', 'amount', 'promise', 'expiry', 'only_if_mode', 'status', 'history'];
  const rows = s.commitments.map((c) => [
    c.id,
    c.scenarioId,
    c.round,
    c.owner,
    c.beneficiary,
    c.kind,
    c.resource,
    c.amount,
    c.promise,
    c.expiry.label,
    c.onlyIfSacrificeMode,
    c.status,
    c.history.map((h) => `${h.status} by ${h.by}: ${h.reason}`).join(' | '),
  ]);
  return toCsv(header, rows);
}

export function csvExport(s: SessionState, kind: CsvKind): string {
  switch (kind) {
    case 'transcript':
      return transcript(s);
    case 'plans':
      return plans(s);
    case 'votes':
      return votes(s);
    case 'commitments':
      return commitments(s);
  }
}
