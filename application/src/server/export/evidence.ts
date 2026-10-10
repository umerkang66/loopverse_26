import 'server-only';
import { createHash } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import { DEPARTMENT_LABEL, RESOURCE_LABEL } from '@/domain/constants';
import { describeEffect } from '@/engine/events';
import { feasiblePlans } from '@/engine/optimizer';
import { basePolicy, constraintsOf, overridePolicy } from '@/engine/policy';
import { RESOURCE_KEYS, type CouncilMessage, type DbTable, type Scenario, type SessionState } from '@/domain/types';
import { csvExport } from './csv';
import { finalAllocation } from './final';
import { jsonExport } from './json';
import type { ComplianceItem } from '@/domain/types';

export interface EvidenceStorage {
  driver: 'supabase' | 'file';
  project: string | null;
  instanceId: string;
  rowCounts: Partial<Record<DbTable, number>> | null;
  parity: Record<'messages' | 'plans' | 'votes' | 'commitments', { db: number | null; export: number; match: boolean | null }> | null;
}

export interface EvidenceOptions {
  now?: string;
  mode: 'live' | 'offline';
  models: { commander: string; departments: string; fallback: string };
  appVersion: string;
  gitCommit: string | null;
  storage: EvidenceStorage;
  extraCompliance?: ComplianceItem[];
}

const sha256 = (data: string) => createHash('sha256').update(data).digest('hex');
const pretty = (data: unknown) => JSON.stringify(data, null, 2);
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
const poolText = (p: Record<string, number>) => RESOURCE_KEYS.map((k) => p[k]).join('/');

export function storageParity(s: SessionState, counts: Partial<Record<DbTable, number>> | null): EvidenceStorage['parity'] {
  if (!counts) return null;
  const mine = {
    messages: s.messages.length,
    plans: s.plans.length,
    votes: s.plans.reduce((n, p) => n + p.votes.length, 0),
    commitments: s.commitments.length,
  };
  const db = { messages: counts.ares_messages, plans: counts.ares_plans, votes: counts.ares_votes, commitments: counts.ares_commitments };
  const entry = (k: keyof typeof mine) => ({ db: db[k] ?? null, export: mine[k], match: db[k] === undefined ? null : db[k] === mine[k] });
  return { messages: entry('messages'), plans: entry('plans'), votes: entry('votes'), commitments: entry('commitments') };
}

function scenarioLog(s: SessionState, sc: Scenario) {
  const messages = s.messages.filter((m) => m.scenarioId === sc.id);
  const plans = s.plans.filter((p) => p.scenarioId === sc.id);
  const event = s.events.find((e) => e.id === sc.eventId) ?? null;
  return {
    scenario: sc,
    event,
    messages,
    plans: plans.map((p) => ({ ...p })),
    votes: plans.flatMap((p) => p.votes.map((v) => ({ ...v, planVersion: p.version }))),
    commitments: s.commitments.filter((c) => c.scenarioId === sc.id),
    commitmentReview: messages.find((m) => m.subtype === 'COMMITMENT_REVIEW')?.data ?? null,
    override: messages.find((m) => m.subtype === 'OVERRIDE_INVOKED')?.data ?? null,
    certificate: sc.certificate,
    outcome: { outcome: sc.outcome, reason: sc.outcomeReason, rounds: sc.round, approvedPlanVersion: sc.approvedPlanVersion },
    timings: sc.startedAt && sc.resolvedAt ? { startedAt: sc.startedAt, resolvedAt: sc.resolvedAt, seconds: (Date.parse(sc.resolvedAt) - Date.parse(sc.startedAt)) / 1000 } : null,
  };
}

function markdownLog(s: SessionState, scenarios: Scenario[], title: string): string {
  const lines = [`# ${title}`, '', `Session ${s.id} · instance ${s.instanceId} · agents ${s.config.mode}`, ''];
  for (const sc of scenarios) {
    const log = scenarioLog(s, sc);
    lines.push(`## ${sc.id} · ${sc.title}`, '', `${sc.kind} · pool ${poolText(sc.pool)} · outcome **${sc.outcome ?? sc.status}**${sc.outcomeReason ? ` — ${sc.outcomeReason}` : ''}`, '');
    if (log.timings) lines.push(`Resolved in ${clock(log.timings.seconds)} (limit 3:00).`, '');
    if (log.event) lines.push(`Event interpretation: ${log.event.interpretation.source}, confidence ${log.event.interpretation.confidence}.`, ...log.event.interpretation.effects.map((e) => `- ${describeEffect(e)}${e.origin ? ` _(${e.origin})_` : ''}`), '');
    lines.push('### Plans', '');
    for (const p of log.plans) {
      const last = p.validations[p.validations.length - 1];
      lines.push(`- v${p.version} ${p.label} — ${p.status}, risk ${p.risk}, sacrifices ${p.sacrifices.join(', ') || 'none'}${last ? `, validator ${last.status} (${last.stage})` : ''}`);
    }
    lines.push('', '### Transcript', '');
    for (const m of log.messages) lines.push(`- \`${m.id}\` R${m.round} **${m.from}** ${m.type}${m.subtype ? `/${m.subtype}` : ''} [${m.source}]: ${m.summary}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Human-readable narrative per event, generated from the recorded run (never hand-written). */
export function crisisHandlingLog(s: SessionState, opts: Pick<EvidenceOptions, 'mode' | 'models'> & { now: string }): string {
  const rule = '─'.repeat(88);
  const out = [`ARES ACCORD — Crisis handling log · session ${s.id.slice(0, 8)}… · exported ${opts.now} · mode ${opts.mode.toUpperCase()} (${opts.models.commander})`, rule];
  const events = s.scenarios.filter((sc) => sc.kind === 'EVENT');
  if (events.length === 0) out.push('No crisis event was injected in this session.');
  for (const sc of events) {
    const record = s.events.find((e) => e.id === sc.eventId);
    const msgs: CouncilMessage[] = s.messages.filter((m) => m.scenarioId === sc.id);
    out.push(`${sc.id}  EVENT ${sc.eventId ?? ''} "${sc.title}" @ colony hour ${sc.colonyHour} · received ${record?.receivedAt ?? '—'}`);
    if (record) {
      const i = record.interpretation;
      out.push(`    Interpretation: ${i.effects.filter((e) => e.type !== 'INFO').map((e) => `${describeEffect(e)}${e.origin ? ` [${e.origin}]` : ''}`).join(' · ') || 'no resource change'} (${i.source}, confidence ${i.confidence.toFixed(2)}) · pool ${poolText(record.poolBefore)} → ${poolText(record.poolAfter)}`);
      for (const a of i.assumptions) out.push(`    Assumption: ${a}`);
    }
    if (sc.previousPlan) out.push(`    Plan in force v${sc.previousPlan.version} → ${sc.previousPlan.status}: ${sc.previousPlan.reasons.join('; ')}`);
    const review = msgs.find((m) => m.subtype === 'COMMITMENT_REVIEW');
    const items = ((review?.data as { items?: { id: string; from: string; to: string; reason: string }[] } | undefined)?.items ?? []).filter((i) => i.from !== i.to);
    out.push(`    Commitment review: ${items.length ? items.map((i) => `${i.id} ${i.from}→${i.to}`).join(' · ') : review ? 'all carried' : 'none recorded'}`);
    const constraints = constraintsOf(sc);
    out.push(`    Feasibility: baseline policy ${feasiblePlans(constraints, basePolicy()).length} · Crisis Override ${feasiblePlans(constraints, overridePolicy()).length}`);
    const override = msgs.find((m) => m.subtype === 'OVERRIDE_INVOKED');
    const denied = msgs.find((m) => m.subtype === 'OVERRIDE_DENIED');
    if (override) out.push(`    Crisis Override INVOKED by ACTUAL: "${override.body.replace(/\s+/g, ' ').slice(0, 300)}"`);
    else if (denied) out.push(`    Crisis Override DENIED: ${denied.summary}`);
    for (let r = 1; r <= sc.round; r++) {
      const inRound = msgs.filter((m) => m.round === r);
      const refusals = inRound.filter((m) => m.subtype === 'SACRIFICE_REFUSAL').map((m) => m.from);
      const offers = inRound.filter((m) => m.type === 'COMMITMENT' && m.subtype === 'OFFER').length;
      const drafts = inRound.filter((m) => m.type === 'PLAN_DRAFT').map((m) => `v${m.planVersion}`);
      out.push(`    Round ${r}: ${inRound.length} messages · ${refusals.length ? `refusals by ${[...new Set(refusals)].join(', ')} · ` : ''}${offers} return offer(s)${drafts.length ? ` · plan ${drafts.join(', ')}` : ''}`);
    }
    const plan = s.plans.find((p) => p.version === sc.approvedPlanVersion);
    const seconds = sc.startedAt && sc.resolvedAt ? (Date.parse(sc.resolvedAt) - Date.parse(sc.startedAt)) / 1000 : null;
    if (sc.outcome === 'APPROVED' && plan) {
      const votes = plan.votes.filter((v) => v.planVersion === plan.version && v.decision === 'ACCEPT').length;
      const report = [...plan.validations].reverse().find((r) => r.stage === 'APPROVAL');
      out.push(`    APPROVED v${plan.version} in round ${sc.round} · ${votes}/4 ACCEPT · validator ${report?.status ?? '—'} ${report ? `${report.checks.filter((c) => c.status === 'PASS').length}/${report.checks.filter((c) => c.status !== 'SKIP').length}` : ''} · risk ${plan.risk}${seconds !== null ? ` · resolved in ${clock(seconds)} (limit 3:00)` : ''}`);
      if (plan.risk > s.config.hitl.riskThreshold) {
        const signed = msgs.find((m) => m.subtype === 'HUMAN_COUNTERSIGN');
        out.push(`    Human-in-the-loop: risk ${plan.risk} > ${s.config.hitl.riskThreshold} → ${signed ? `countersigned by Mission Control (${signed.createdAt})` : plan.status === 'RATIFIED' ? 'countersigned' : 'awaiting countersign'}`);
      }
    } else {
      out.push(`    ${sc.outcome ?? sc.status}${sc.outcomeReason ? `: ${sc.outcomeReason}` : ''}${seconds !== null ? ` · resolved in ${clock(seconds)}` : ''}`);
      for (const request of sc.certificate?.requests ?? []) out.push(`    Needed: ${request}`);
    }
    const settle = msgs.find((m) => m.subtype === 'PROMISE_SETTLEMENT');
    if (settle) out.push(`    Promises: ${settle.summary.replace(/^Promises settled: /, '')}`);
    for (const f of msgs.filter((m) => m.subtype === 'FAULT_INJECTED')) out.push(`    ${f.summary}`);
    out.push('');
  }
  const baseline = s.scenarios.find((sc) => sc.kind === 'BASELINE');
  if (baseline) {
    out.push(rule, `Baseline ${baseline.id}: ${baseline.outcome ?? baseline.status} in ${baseline.round} round(s). Pool ${poolText(baseline.pool)} (${RESOURCE_KEYS.map((k) => RESOURCE_LABEL[k].name).join('/')}).`);
    const dept = Object.entries(s.agents).filter(([id]) => id !== 'COMMANDER').map(([id, a]) => `${DEPARTMENT_LABEL[id as keyof typeof DEPARTMENT_LABEL] ?? id}: sacrifices ${a.sacrificeLedger.length}`);
    out.push(dept.join(' · '));
  }
  return out.join('\n') + '\n';
}

/** Builds the evidence zip. Every file is generated from the recorded session; nothing is hand-written. */
export function buildEvidenceZip(s: SessionState, opts: EvidenceOptions): { zip: Uint8Array; manifest: Record<string, unknown>; files: string[] } {
  const now = opts.now ?? new Date().toISOString();
  const files: Record<string, string> = {};
  const baseline = s.scenarios.filter((sc) => sc.kind === 'BASELINE');
  const events = s.scenarios.filter((sc) => sc.kind === 'EVENT');

  const latest = finalAllocation(s);
  files['final_allocation.json'] = pretty({ ...latest, per_scenario: Object.fromEntries(s.scenarios.map((sc) => [sc.id, finalAllocation(s, sc.id)])) });
  files['council_transcript.json'] = pretty(s.messages.map((m) => ({ ...m })));
  files['council_transcript.csv'] = csvExport(s, 'transcript');
  files['opening_negotiation_log.json'] = pretty(baseline.map((sc) => scenarioLog(s, sc)));
  files['opening_negotiation_log.md'] = markdownLog(s, baseline, 'Opening negotiation log');
  files['post_event_log.json'] = pretty(events.map((sc) => scenarioLog(s, sc)));
  files['post_event_log.md'] = markdownLog(s, events, 'Post-event log');
  files['crisis_handling_log.txt'] = crisisHandlingLog(s, { mode: opts.mode, models: opts.models, now });
  for (const sc of s.scenarios) files[`final_plan_${sc.id}.json`] = pretty(finalAllocation(s, sc.id));
  files['plans.csv'] = csvExport(s, 'plans');
  files['votes.csv'] = csvExport(s, 'votes');
  files['commitments.csv'] = csvExport(s, 'commitments');
  const full = jsonExport(s, opts.extraCompliance ?? [], now);
  files['compliance_report.json'] = pretty(full.compliance);

  const bySource = (source: string) => s.messages.filter((m) => m.source === source).length;
  const traceIds = [...new Set(s.messages.map((m) => m.meta?.traceId).filter((t): t is string => Boolean(t)))];
  const readme = [
    'ARES ACCORD — evidence pack',
    `Session ${s.id} (instance ${s.instanceId}), exported ${now}.`,
    `Agents ran in ${opts.mode.toUpperCase()} mode. Every file is generated from the recorded session; nothing here is hand-edited or pre-generated.`,
    'Messages keep their `source` label: LLM (live model call), FALLBACK (rule-based, only after a model failure), DETERMINISTIC (engine/validator), HUMAN (judge action).',
    '',
    'final_allocation.json            Output-schema-compatible allocation for the latest scenario, plus per_scenario.',
    'council_transcript.json/.csv     The full persistent transcript across all scenarios.',
    'opening_negotiation_log.json/.md Baseline scenario: messages, plans, votes, outcome, timings.',
    'post_event_log.json/.md          Event scenarios: interpretation, stale/invalid marking, commitment review, override, certificate.',
    'crisis_handling_log.txt          Narrative per event.',
    'final_plan_S*.json               Each scenario\'s approved plan (or certificate / deadlock report).',
    'plans.csv, votes.csv, commitments.csv  Structured records.',
    'compliance_report.json           The computed checklist with evidence message ids.',
    'manifest.json                    Counts by source, trace ids, SHA-256 of every file, storage row counts and parity.',
    '',
  ].join('\n');
  files['README.txt'] = readme;

  const manifest = {
    sessionId: s.id,
    instanceId: s.instanceId,
    exportedAt: now,
    app: 'ARES ACCORD',
    appVersion: opts.appVersion,
    gitCommit: opts.gitCommit,
    mode: opts.mode,
    models: opts.models,
    scenarios: s.scenarios.map((sc) => ({ id: sc.id, kind: sc.kind, outcome: sc.outcome ?? sc.status, rounds: sc.round, approvedPlanVersion: sc.approvedPlanVersion })),
    messageCounts: { total: s.messages.length, LLM: bySource('LLM'), FALLBACK: bySource('FALLBACK'), DETERMINISTIC: bySource('DETERMINISTIC'), HUMAN: bySource('HUMAN') },
    openaiTraceIds: traceIds,
    storage: opts.storage,
    sha256: Object.fromEntries(Object.entries(files).map(([name, text]) => [name, sha256(text)])),
  };
  files['manifest.json'] = pretty(manifest);

  const zip = zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])), { level: 6 });
  return { zip, manifest, files: Object.keys(files) };
}
