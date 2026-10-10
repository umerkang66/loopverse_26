import 'server-only';
import { DEPARTMENT_LABEL, RESOURCE_LABEL } from '@/domain/constants';
import { PROFILES, getMode, lossOf } from '@/domain/scenario';
import {
  DEPARTMENT_IDS,
  RESOURCE_KEYS,
  type AgentId,
  type Commitment,
  type CouncilMessage,
  type DepartmentId,
  type Plan,
  type Scenario,
  type SessionState,
  type ValidationReport,
} from '@/domain/types';
import { sacrificeModeOf, selectionKey } from '@/engine/catalog';
import { effectiveLimits } from '@/engine/policy';
import { capOf, fmt, fmtVs } from '@/engine/resources';
import { failedChecks } from '@/engine/validator';
import type { ScenarioView } from '../orchestrator/view';
import type { RankedPlan } from '@/engine/optimizer';

const callsign = (id: string) => (id in PROFILES ? PROFILES[id as AgentId].callsign : id);

export function deadlineLeft(scenario: Scenario, now: string): string {
  if (!scenario.deadlineAt) return 'no deadline';
  const ms = Math.max(0, Date.parse(scenario.deadlineAt) - Date.parse(now));
  const m = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(sec).padStart(2, '0')} left`;
}

export function policyLine(scenario: Scenario): string {
  const limits = effectiveLimits(scenario.policy, scenario);
  const override = scenario.policy.crisisOverride
    ? 'Crisis Override: ACTIVE'
    : scenario.kind === 'EVENT' && scenario.overrideAvailable
      ? 'Crisis Override: available (only if no plan fits baseline limits)'
      : 'Crisis Override: not available (baseline)';
  const caps = [
    scenario.riskCap !== null ? `event risk cap ${scenario.riskCap}` : '',
    scenario.maxSacrificesCap !== null ? `event sacrifice cap ${scenario.maxSacrificesCap}` : '',
  ].filter(Boolean);
  return `risk ≤ ${limits.riskLimit} · max Sacrifice ${limits.maxSacrifices} · returns required ${scenario.policy.requiredReturnCommitments} · ${override}${caps.length ? ` · ${caps.join(' · ')}` : ''}`;
}

export function poolLine(scenario: Scenario): string {
  const reserve = RESOURCE_KEYS.filter((k) => (scenario.reserveRequirements[k] ?? 0) > 0).map((k) => `${scenario.reserveRequirements[k]} ${RESOURCE_LABEL[k].name}`);
  return `${fmt(scenario.pool)} · reserve requirements: ${reserve.length ? reserve.join(', ') : 'none'} · forbidden modes: ${scenario.forbiddenModes.length ? scenario.forbiddenModes.join(', ') : 'none'}`;
}

export function reportLine(report: ValidationReport | undefined): string {
  if (!report) return 'not validated yet';
  if (report.status === 'PASS') return `PASS (${report.stage})`;
  return `FAIL (${report.stage}) · ${failedChecks(report).map((c) => `${c.id}: ${c.reason}`).join(' | ')}`;
}

export function planLine(plan: Plan, scenario: Scenario): string {
  const cap = capOf(scenario.pool, scenario.reserveRequirements);
  const limits = effectiveLimits(scenario.policy, scenario);
  return `v${plan.version} ${plan.status} "${plan.label}" ${selectionKey(plan.selections).replace(/\+/g, ' ')} → ${fmtVs(plan.totals, cap)} · risk ${plan.risk}/${limits.riskLimit}${
    plan.sacrifices.length ? ` · Sacrifice ${plan.sacrifices.join(', ')}` : ''
  }${plan.commitmentIds.length ? ` · returns ${plan.commitmentIds.join(', ')}` : ''}`;
}

export function feasibleLines(plans: readonly RankedPlan[], max = 6): string {
  if (plans.length === 0) return '  (none)';
  return plans
    .slice(0, max)
    .map((p, i) => {
      const reserve = RESOURCE_KEYS.filter((k) => p.reserve[k] > 0).map((k) => `${RESOURCE_LABEL[k].short}${p.reserve[k]}`).join(' ');
      return `  ${String.fromCharCode(65 + i)}) ${p.key.replace(/\+/g, ' ')} → ${fmt(p.totals)} · risk ${p.risk} · Sacrifice ${p.sacrifices.join(', ') || 'none'} · reserve ${reserve || 'none'}${
        p.fairnessPenalty ? ` · fairness penalty ${p.fairnessPenalty}` : ''
      }`;
    })
    .join('\n');
}

export function optimizerBlock(view: ScenarioView): string {
  const lines = [`OPTIMIZER (81 combinations checked) — feasible under current policy: ${view.feasibleCurrent.length}`, feasibleLines(view.feasibleCurrent)];
  if (view.feasibleOverride) {
    lines.push(`  …under Crisis Override (if invoked): ${view.feasibleOverride.length}${view.overrideWouldBeAllowed ? '' : ' (override not allowed now)'}`);
    if (view.feasibleOverride.length && view.feasibleCurrent.length === 0) lines.push(feasibleLines(view.feasibleOverride));
  }
  if (view.provenInfeasible) lines.push('  PROVEN INFEASIBLE under every policy the council may use (see certificate).');
  return lines.join('\n');
}

export function commitmentLine(c: Commitment): string {
  const what = c.resource ? `${c.kind} ${c.amount ?? ''} ${RESOURCE_LABEL[c.resource].name}`.replace(/\s+/g, ' ') : c.kind;
  return `${c.id} · ${callsign(c.owner)} → ${callsign(c.beneficiary)} · ${what} · "${c.promise}" · ${c.status}${c.onlyIfSacrificeMode ? ` · only if ${c.onlyIfSacrificeMode}` : ''} · expires ${c.expiry.label}`;
}

function messageLine(m: CouncilMessage): string {
  const to = m.to === 'ALL' ? 'ALL' : m.to.map(callsign).join(',');
  const kind = m.subtype ? `${m.type}/${m.subtype}` : m.type;
  const words = m.body && m.body !== m.summary ? ` "${m.body.replace(/\s+/g, ' ').slice(0, 240)}"` : '';
  return `  [${m.id} R${m.round} ${kind}] ${callsign(m.from)} → ${to}: ${m.summary}${words}`;
}

/** Messages addressed to this agent (or ALL) since its last turn, excluding its own. Capped at the newest 25. */
export function inboxLines(s: SessionState, agentId: AgentId, sinceSeq: number, scenarioId: string): string {
  const relevant = s.messages.filter(
    (m) => m.seq > sinceSeq && m.from !== agentId && (m.to === 'ALL' || m.to.includes(agentId)) && (m.scenarioId === scenarioId || m.type === 'EVENT'),
  );
  const shown = relevant.slice(-25);
  const omitted = relevant.length - shown.length;
  return [omitted > 0 ? `  (${omitted} earlier messages omitted)` : '', ...shown.map(messageLine)].filter(Boolean).join('\n') || '  (none)';
}

export function memoryLines(s: SessionState, agentId: AgentId, max = 6): string {
  const notes = s.agents[agentId].memory.slice(-max);
  return notes.length ? notes.map((n) => `  - ${n.scenarioId} R${n.round}: ${n.note}`).join('\n') : '  (no notes yet)';
}

function eventLines(s: SessionState, scenario: Scenario): string {
  if (scenario.kind !== 'EVENT') return '';
  const record = s.events.find((e) => e.id === scenario.eventId);
  const lines = [`EVENT: ${scenario.title} — ${scenario.description}`];
  if (record) lines.push(`  pool before ${fmt(record.poolBefore)} → after ${fmt(record.poolAfter)}`);
  if (scenario.previousPlan) lines.push(`  previous plan v${scenario.previousPlan.version} is ${scenario.previousPlan.status}: ${scenario.previousPlan.reasons.join('; ')}`);
  if (scenario.priorities.length) lines.push(`  priorities: ${scenario.priorities.join(' · ')}`);
  return lines.join('\n');
}

function header(s: SessionState, scenario: Scenario, round: number, phase: string, now: string, who: string): string {
  const voting = round >= scenario.minRoundsBeforeApproval ? 'voting allowed this round' : `voting opens in round ${scenario.minRoundsBeforeApproval}`;
  return [
    `=== COUNCIL PACKET for ${who} · ${scenario.id} ${scenario.kind} · ${scenario.title} · colony hour ${scenario.colonyHour} ===`,
    `Round ${round} of max ${scenario.maxRounds} · phase ${phase} · ${voting} · deadline ${deadlineLeft(scenario, now)}`,
    `POOL: ${poolLine(scenario)}`,
    `POLICY: ${policyLine(scenario)}`,
  ].join('\n');
}

function latestAsks(s: SessionState, scenario: Scenario, dept: DepartmentId): string[] {
  const briefings = s.messages.filter((m) => m.scenarioId === scenario.id && m.type === 'BRIEFING');
  const last = briefings[briefings.length - 1];
  const asks = ((last?.data as { asks?: { to: string; ask: string }[] })?.asks ?? []).filter((a) => a.to === 'ALL' || a.to === dept);
  return asks.map((a) => a.ask);
}

export function departmentPacket(args: {
  s: SessionState;
  view: ScenarioView;
  dept: DepartmentId;
  round: number;
  phase: string;
  now: string;
  task?: string;
}): string {
  const { s, view, dept, round, phase, now } = args;
  const scenario = view.scenario;
  const agent = s.agents[dept];
  const p = PROFILES[dept];
  const plan = view.latestPlan;
  const mine = s.commitments.filter((c) => (c.owner === dept || c.beneficiary === dept) && !['WITHDRAWN', 'EXPIRED'].includes(c.status));
  const asks = latestAsks(s, scenario, dept);
  const priorSacrifices = agent.sacrificeLedger.map((l) => `${l.modeId} in ${l.scenarioId}`).join(', ') || 'none';
  const sacrificeMode = sacrificeModeOf(dept);
  return [
    header(s, scenario, round, phase, now, `${p.callsign} (${p.departmentName})`),
    eventLines(s, scenario),
    `PLAN ON THE TABLE: ${plan ? planLine(plan, scenario) : 'none drafted yet'}`,
    plan ? `  Validator: ${reportLine(plan.validations[plan.validations.length - 1])}` : '',
    view.planInForce && view.planInForce.scenarioId !== scenario.id ? `PLAN IN FORCE BEFORE THIS EVENT: ${planLine(view.planInForce, scenario)}` : '',
    optimizerBlock(view),
    scenario.certificate ? `INFEASIBILITY CERTIFICATE: ${scenario.certificate.blocking.map((b) => b.detail).join(' | ')} · requests: ${scenario.certificate.requests.join(' ')}` : '',
    view.candidates.includes(dept)
      ? `YOUR SACRIFICE MODE ${sacrificeMode} appears in feasible plans. Loss if you sacrifice: ${lossOf(sacrificeMode) ?? getMode(sacrificeMode).consequence}`
      : 'Your Sacrifice mode is not needed in any feasible plan right now.',
    `YOU: requesting ${agent.requestedMode ?? 'nothing yet'} · sacrifice stance: ${agent.stance?.sacrifice ?? 'not asked yet'} · prior sacrifices: ${priorSacrifices}`,
    `COMMITMENTS INVOLVING YOU:\n${mine.length ? mine.map((c) => `  ${commitmentLine(c)}`).join('\n') : '  none'}`,
    `NEW MESSAGES SINCE YOUR LAST TURN (oldest first):\n${inboxLines(s, dept, agent.lastSeenSeq, scenario.id)}`,
    `WHAT THE COMMANDER ASKS OF YOU: ${asks.length ? asks.join(' / ') : 'state your position'}`,
    `YOUR PRIVATE MEMORY (newest last):\n${memoryLines(s, dept)}`,
    args.task ?? 'Respond with your turn (JSON schema enforced).',
  ]
    .filter(Boolean)
    .join('\n');
}

export function departmentPositionsDigest(s: SessionState, scenario: Scenario, round: number): string {
  return DEPARTMENT_IDS.map((dept) => {
    const a = s.agents[dept];
    const msgs = s.messages.filter((m) => m.scenarioId === scenario.id && m.round === round && m.from === dept);
    const offers = msgs.filter((m) => m.type === 'COMMITMENT' && m.subtype === 'OFFER').map((m) => m.summary);
    const responses = msgs.filter((m) => m.type === 'COMMITMENT' && (m.subtype === 'ACCEPT' || m.subtype === 'DECLINE')).map((m) => m.summary);
    const objections = msgs.filter((m) => m.type === 'OBJECTION').map((m) => `${m.id} ${m.subtype}: ${m.body.slice(0, 120)}`);
    const counter = msgs.find((m) => m.type === 'COUNTEROFFER');
    return [
      `  ${PROFILES[dept].callsign} (${DEPARTMENT_LABEL[dept]}): requests ${a.requestedMode ?? '?'} · stance ${a.stance?.sacrifice ?? 'NOT_ASKED'}${a.stance?.conditions.length ? ` (needs: ${a.stance.conditions.join('; ')})` : ''}`,
      counter ? `    counteroffer ${counter.id}: ${counter.summary}` : '',
      ...objections.map((o) => `    objection ${o}`),
      ...offers.map((o) => `    offer ${o}`),
      ...responses.map((r) => `    response ${r}`),
    ]
      .filter(Boolean)
      .join('\n');
  }).join('\n');
}

export function commanderPacket(args: {
  s: SessionState;
  view: ScenarioView;
  round: number;
  phase: string;
  now: string;
  task: string;
  requestedCheck?: ValidationReport;
}): string {
  const { s, view, round, phase, now } = args;
  const scenario = view.scenario;
  const plan = view.latestPlan;
  const live = s.commitments.filter((c) => !['WITHDRAWN', 'EXPIRED', 'DECLINED'].includes(c.status));
  const fairness = [
    ...Object.entries(view.fairness.priorSacrifices).map(([d, n]) => `${d} sacrificed ${n}× before`),
    ...view.fairness.duePriority.map((d) => `${d} is owed first priority this cycle`),
  ];
  const cert = scenario.certificate;
  return [
    header(s, scenario, round, phase, now, `${PROFILES.COMMANDER.callsign} (Commander)`),
    eventLines(s, scenario),
    `PLAN ON THE TABLE: ${plan ? planLine(plan, scenario) : 'none drafted yet'}`,
    plan ? `  Validator: ${reportLine(plan.validations[plan.validations.length - 1])}` : '',
    args.requestedCheck ? `REQUESTED COMBINATION CHECK: ${reportLine(args.requestedCheck)}` : '',
    view.planInForce && view.planInForce.scenarioId !== scenario.id ? `PLAN IN FORCE BEFORE THIS EVENT: ${planLine(view.planInForce, scenario)}` : '',
    optimizerBlock(view),
    cert ? `INFEASIBILITY CERTIFICATE: ${cert.blocking.map((b) => b.detail).join(' | ')} · requests: ${cert.requests.join(' ')}` : '',
    `DEPARTMENT POSITIONS (round ${round}):\n${departmentPositionsDigest(s, scenario, round)}`,
    `COMMITMENT LEDGER:\n${live.length ? live.map((c) => `  ${commitmentLine(c)}`).join('\n') : '  none'}`,
    `FAIRNESS LEDGER: ${fairness.length ? fairness.join(' · ') : 'no prior sacrifices or owed promises'}`,
    `NEW MESSAGES SINCE YOUR LAST TURN (oldest first):\n${inboxLines(s, 'COMMANDER', s.agents.COMMANDER.lastSeenSeq, scenario.id)}`,
    `YOUR PRIVATE MEMORY (newest last):\n${memoryLines(s, 'COMMANDER')}`,
    args.task,
  ]
    .filter(Boolean)
    .join('\n');
}
