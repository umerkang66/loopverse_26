/**
 * Runs a full council in-process (no web server): baseline → optional event → renegotiation.
 *
 *   npm run simulate -- --offline --event=PRACTICE_ROVER
 *   npm run simulate -- --event=PRACTICE_SOLAR --bodies          (live agents; uses OPENAI_API_KEY from .env)
 *   npm run simulate -- --offline --event=official --json > run.json
 *
 * Flags: --auto-countersign (simulated human for HITL) · --offline · --event=<preset id>|official|none · --bodies · --json · --out=<file> · --db · --max-rounds=N
 *        --resources=P,W,O,R,B · --keep (keep the temp data dir) · --timeout=<seconds>
 * Storage defaults to a temp file store, so simulations never touch your database; --db persists to Supabase under
 * instance sim-<timestamp>. Exits 1 if any applicable compliance item fails.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EVENT_PRESETS } from '@/domain/scenario';
import { AGENT_IDS, RESOURCE_KEYS, type CouncilMessage, type ResourceVector, type SessionState } from '@/domain/types';
import { computeCompliance } from '@/engine/compliance';
import { jsonExport } from '@/server/export/json';
import type { ServerEnv } from '@/server/env';
import { persistedItem } from '@/server/public-state';
import { AresRuntime } from '@/server/runtime';

const flags = new Map<string, string | true>();
for (const arg of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
  if (m) flags.set(m[1]!, m[2] ?? true);
}
const str = (name: string) => (typeof flags.get(name) === 'string' ? (flags.get(name) as string) : undefined);

const asJson = flags.has('json');
const say = (...parts: unknown[]) => (asJson ? console.error : console.log)(...parts);
const fail = (text: string): never => {
  console.error(text);
  process.exit(2);
};

const eventArg = (str('event') ?? 'none').trim();
const presetId = eventArg.toLowerCase() === 'none' ? null : eventArg.toLowerCase() === 'official' ? 'OFFICIAL_SAMPLE' : eventArg.toUpperCase();
if (presetId && !EVENT_PRESETS.some((p) => p.id === presetId)) {
  fail(`Unknown --event=${eventArg}. Use one of: ${EVENT_PRESETS.map((p) => p.id).join(', ')}, official, none.`);
}

let resources: ResourceVector | undefined;
if (str('resources')) {
  const values = str('resources')!.split(',').map((v) => Number(v.trim()));
  if (values.length !== 5 || values.some((v) => !Number.isInteger(v) || v < 0 || v > 999)) fail('--resources needs five integers: power,water,oxygen,robot,bandwidth');
  resources = Object.fromEntries(RESOURCE_KEYS.map((k, i) => [k, values[i]!])) as ResourceVector;
}
const maxRounds = str('max-rounds') ? Number(str('max-rounds')) : undefined;
const timeoutMs = (Number(str('timeout') ?? 900) || 900) * 1000;
const useDb = flags.has('db');
const dataDir = mkdtempSync(path.join(tmpdir(), 'ares-sim-'));
const instance = useDb ? `sim-${new Date().toISOString().replace(/[:.]/g, '-')}` : 'sim';

const overrides: Partial<ServerEnv> = {
  DATA_DIR: dataDir,
  ARES_INSTANCE_ID: instance,
  ...(flags.has('offline') ? { mode: 'offline' as const } : {}),
  ...(useDb ? { STORAGE_DRIVER: 'supabase' as const, storageDriver: 'supabase' as const } : { STORAGE_DRIVER: 'file' as const, storageDriver: 'file' as const }),
};

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const pad = (v: unknown, n: number) => String(v).padEnd(n);

function line(m: CouncilMessage): string {
  const to = m.to === 'ALL' ? 'ALL' : m.to.join(',');
  const tag = m.source === 'LLM' ? `LLM ${m.meta ? secs(m.meta.latencyMs) : ''}` : m.source === 'FALLBACK' ? `FALLBACK(${m.meta?.fallbackReason ?? '?'})` : m.source;
  const kind = `${m.type}${m.subtype ? `/${m.subtype}` : ''}`;
  return `[${String(m.seq).padStart(3)}] ${m.scenarioId} R${m.round} ${pad(kind, 30)} ${pad(`${m.from}→${to}`, 26)} ${m.summary}  · ${tag}`;
}

function wrap(text: string, indent = '        ', width = 118): string {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let cur = '';
    for (const word of para.split(/\s+/)) {
      if ((cur + ' ' + word).trim().length > width - indent.length) {
        out.push(indent + cur.trim());
        cur = '';
      }
      cur += ' ' + word;
    }
    if (cur.trim()) out.push(indent + cur.trim());
  }
  return out.join('\n');
}

/** Wall time per phase: each contiguous block of messages owns the time since the previous block ended. */
function phaseTimings(s: SessionState) {
  const totals = new Map<string, { ms: number; blocks: number }>();
  let prevEnd: number | null = null;
  let i = 0;
  while (i < s.messages.length) {
    const first = s.messages[i]!;
    let j = i;
    while (j + 1 < s.messages.length && s.messages[j + 1]!.phase === first.phase && s.messages[j + 1]!.round === first.round && s.messages[j + 1]!.scenarioId === first.scenarioId) j++;
    const end = Date.parse(s.messages[j]!.createdAt);
    const begin = prevEnd ?? Date.parse(first.createdAt);
    const t = totals.get(first.phase) ?? { ms: 0, blocks: 0 };
    t.ms += Math.max(0, end - begin);
    t.blocks++;
    totals.set(first.phase, t);
    prevEnd = end;
    i = j + 1;
  }
  return totals;
}

/** Model latency per call kind (one entry per agent turn, not per message). */
function callLatencies(s: SessionState) {
  const seen = new Set<string>();
  const groups = new Map<string, number[]>();
  for (const m of s.messages) {
    if (m.source !== 'LLM' || !m.meta) continue;
    const key = m.turnId ?? m.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const who = m.from === 'COMMANDER' ? 'commander' : 'department';
    const g = groups.get(`${who}/${m.phase}`) ?? [];
    g.push(m.meta.latencyMs);
    groups.set(`${who}/${m.phase}`, g);
  }
  return groups;
}

async function main() {
  const rt = new AresRuntime({ source: process.env, env: overrides });
  await rt.ready();
  const mode = rt.env.mode;
  say(`ARES ACCORD simulation · agents ${mode}${mode === 'live' ? ` (${rt.env.OPENAI_MODEL_COMMANDER} / ${rt.env.OPENAI_MODEL_DEPARTMENTS})` : ''} · storage ${rt.persistence.driver}${useDb ? ` (instance ${instance})` : ''} · event ${presetId ?? 'none'}`);
  if (mode === 'offline' && !flags.has('offline')) say('No OPENAI_API_KEY found: running the labeled rule-based fallback agents.');

  const bodies = flags.has('bodies');
  rt.bus.subscribe((_id, evt) => {
    if (evt.type === 'message.created') {
      say(line(evt.message));
      if (bodies && evt.message.body && evt.message.body !== evt.message.summary) say(wrap(evt.message.body));
    } else if (evt.type === 'toast' && evt.level !== 'info' && evt.level !== 'success') {
      say(`   ! ${evt.text}`);
    }
  });

  /** HITL: a plan with risk above the threshold waits for a human. `--auto-countersign` stands in for that human (labeled simulated). */
  const settleHuman = async () => {
    const sc = rt.latestScenario();
    if (!sc || sc.status !== 'AWAITING_COUNTERSIGN') return;
    if (flags.has('auto-countersign')) {
      await rt.countersign('COUNTERSIGN', 'HUMAN (simulated): auto-countersigned by simulate.ts --auto-countersign');
      say('   ✍ HUMAN (simulated) countersigned the plan');
    } else {
      say(`   ✍ ${sc.id} is awaiting a human countersign (pass --auto-countersign to simulate one)`);
    }
  };

  const started = Date.now();
  await rt.start({ ...(resources ? { resources } : {}), ...(maxRounds ? { maxRounds } : {}) });
  await rt.waitForIdle(timeoutMs);
  await settleHuman();
  const baselineMs = Date.now() - started;

  let eventMs = 0;
  if (presetId) {
    const { interpretation, forecast } = await rt.interpretEvent({ kind: 'preset', presetId });
    say(`\n── EVENT ${interpretation.title}: ${forecast.effects.join('; ')} → feasible ${forecast.feasibleBase} (base) / ${forecast.feasibleOverride} (override); plan in force would be ${forecast.previousPlanWouldBe ?? '—'}`);
    const t = Date.now();
    await rt.applyEvent(interpretation);
    await rt.waitForIdle(timeoutMs);
    await settleHuman();
    eventMs = Date.now() - t;
  }
  if (rt.isRunning()) say(`\nTimed out after ${secs(timeoutMs)}; the negotiation is still running.`);

  await rt.persistence.flushNow(15_000);
  const health = useDb ? await rt.health(true) : null;
  const s = rt.getSnapshot();

  say('\n══ OUTCOMES');
  for (const sc of s.scenarios) {
    const plan = s.plans.find((p) => p.version === sc.approvedPlanVersion);
    const dur = sc.startedAt && sc.resolvedAt ? secs(Date.parse(sc.resolvedAt) - Date.parse(sc.startedAt)) : '—';
    const sel = plan ? `${plan.selections.LIFE_SUPPORT}+${plan.selections.MEDICAL}+${plan.selections.FOOD}+${plan.selections.ENGINEERING} risk ${plan.risk}` : '';
    say(`  ${sc.id} ${pad(sc.kind, 8)} ${pad(sc.outcome ?? sc.status, 12)} rounds ${sc.round}  ${dur.padStart(7)}  ${plan ? `v${plan.version} ${sel}` : ''}  ${sc.outcomeReason ?? ''}`);
    if (sc.outcome === 'INFEASIBLE' && sc.certificate) say(`     certificate: ${sc.certificate.requests.join(' | ')}`);
  }
  say(`  wall time: baseline ${secs(baselineMs)}${presetId ? ` · event ${secs(eventMs)}` : ''}`);

  const counts = { LLM: 0, FALLBACK: 0, DETERMINISTIC: 0, HUMAN: 0 };
  for (const m of s.messages) counts[m.source]++;
  say(`\n══ MESSAGES ${s.messages.length} · LLM ${counts.LLM} · FALLBACK ${counts.FALLBACK} · DETERMINISTIC ${counts.DETERMINISTIC}`);
  say('══ AGENTS');
  for (const id of AGENT_IDS) {
    const st = s.agents[id].stats;
    const calls = st.llmCalls + st.fallbacks;
    say(`  ${pad(id, 13)} llm ${String(st.llmCalls).padStart(3)} · fallback ${String(st.fallbacks).padStart(3)} · avg ${calls ? secs(st.totalLatencyMs / calls) : '—'} · tokens in ${st.inputTokens} / out ${st.outputTokens} · memory notes ${s.agents[id].memory.length}`);
  }
  say('══ PHASE WALL TIME (sum over rounds)');
  for (const [phase, t] of phaseTimings(s)) say(`  ${pad(phase, 12)} ${secs(t.ms).padStart(7)} over ${t.blocks} block(s) · avg ${secs(t.ms / t.blocks)}`);
  const lat = callLatencies(s);
  if (lat.size) {
    say('══ MODEL LATENCY PER CALL');
    for (const [k, v] of lat) {
      const sorted = [...v].sort((a, b) => a - b);
      say(`  ${pad(k, 26)} n=${String(v.length).padStart(3)} avg ${secs(v.reduce((a, b) => a + b, 0) / v.length)} · p50 ${secs(sorted[Math.floor(v.length / 2)]!)} · max ${secs(sorted[v.length - 1]!)}`);
    }
  }

  if (health) {
    const rows = (health.rowCounts ?? {}) as Record<string, number>;
    say(`══ SUPABASE ${JSON.stringify((health.storage as { state: string }).state)} · ares_messages ${rows.ares_messages ?? '?'} / ${s.messages.length} in memory · ${Object.entries(rows).map(([k, v]) => `${k.replace('ares_', '')} ${v}`).join(' · ')}`);
  }

  const report = computeCompliance(s, [persistedItem(s, rt.persistence.status())]);
  say(`\n══ COMPLIANCE ${report.passed}/${report.applicable}`);
  for (const i of report.items) say(`  ${pad(i.status, 7)} ${pad(i.id, 22)} ${i.label}${i.status === 'PASS' || i.status === 'NA' ? '' : `  → ${i.detail}`}`);

  const exported = jsonExport(s, [persistedItem(s, rt.persistence.status())]);
  if (str('out')) {
    writeFileSync(str('out')!, JSON.stringify(exported, null, 2));
    say(`\nExport written to ${str('out')}`);
  }
  if (asJson) console.log(JSON.stringify(exported, null, 2));

  const failed = report.items.filter((i) => i.status === 'FAIL');
  await rt.dispose();
  if (!flags.has('keep')) rmSync(dataDir, { recursive: true, force: true });
  else say(`Data kept in ${dataDir}`);
  if (failed.length) say(`\n✗ ${failed.length} compliance item(s) failed: ${failed.map((i) => i.id).join(', ')}`);
  else say('\n✓ All applicable compliance items pass.');
  process.exit(failed.length ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
