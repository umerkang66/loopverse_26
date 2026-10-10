// Pure, derived views of the server state. The client never computes authority: these only arrange
// what the server sent (plus engine previews such as totals per department).
import { DEPARTMENT_LABEL, RESOURCE_LABEL } from '@/domain/constants';
import { getMode, isModeId } from '@/domain/scenario';
import {
  DEPARTMENT_IDS,
  RESOURCE_KEYS,
  type Commitment,
  type CouncilMessage,
  type DepartmentId,
  type Plan,
  type PublicState,
  type ResourceKey,
  type ResourceVector,
  type RunState,
  type Scenario,
  type Selections,
  type StorageStatus,
  type ValidationReport,
  type Vote,
} from '@/domain/types';
import { selectionTotals } from '@/engine/catalog';
import { capOf } from '@/engine/resources';
import type { Tone } from './theme';

// ── scenarios and plans ──
export function currentScenario(s: PublicState): Scenario | null {
  return s.scenarios.find((x) => x.id === s.run.scenarioId) ?? s.scenarios[s.scenarios.length - 1] ?? null;
}

export function focusScenario(s: PublicState, focusId: string | null): Scenario | null {
  return (focusId ? s.scenarios.find((x) => x.id === focusId) : undefined) ?? currentScenario(s);
}

export const plansOf = (s: PublicState, scenarioId: string): Plan[] => s.plans.filter((p) => p.scenarioId === scenarioId);
export const planByVersion = (s: PublicState, version: number | null | undefined): Plan | null =>
  version ? (s.plans.find((p) => p.version === version) ?? null) : null;
export const planInForce = (s: PublicState): Plan | null => planByVersion(s, s.planInForceVersion);

export function focusDraft(s: PublicState, sc: Scenario | null): Plan | null {
  if (!sc) return null;
  const plans = plansOf(s, sc.id);
  return plans[plans.length - 1] ?? null;
}

/** The plan the Mode Board shows: the focus scenario's latest draft, else the plan in force. */
export function boardPlan(s: PublicState, sc: Scenario | null, showInForce: boolean): Plan | null {
  const inForce = planInForce(s);
  if (showInForce && inForce) return inForce;
  return focusDraft(s, sc) ?? inForce;
}

export const latestReport = (plan: Plan | null): ValidationReport | null => plan?.validations[plan.validations.length - 1] ?? null;

/** Ballots stop counting once a version is superseded, STALE or INVALID: any new version needs four fresh votes. */
export const VOTES_LIVE: readonly Plan['status'][] = ['READY', 'VOTING', 'APPROVED', 'RATIFIED', 'REJECTED'];
export const votesCleared = (plan: Plan | null): boolean => !!plan && plan.votes.length > 0 && !VOTES_LIVE.includes(plan.status);

/** Latest ballot per department bound to this exact version and hash (none once the version is no longer live). */
export function votesFor(plan: Plan | null): Partial<Record<DepartmentId, Vote>> {
  const out: Partial<Record<DepartmentId, Vote>> = {};
  if (!plan || !VOTES_LIVE.includes(plan.status)) return out;
  for (const v of plan.votes) if (v.planVersion === plan.version && v.planHash === plan.hash) out[v.agentId] = v;
  return out;
}

export function voteCounts(plan: Plan | null): { accept: number; reject: number; pending: number } {
  const votes = Object.values(votesFor(plan));
  const accept = votes.filter((v) => v.decision === 'ACCEPT').length;
  const reject = votes.filter((v) => v.decision === 'REJECT').length;
  return { accept, reject, pending: 4 - accept - reject };
}

/** Ballots that were cleared when this version replaced the previous one. */
export function clearedVotes(s: PublicState, plan: Plan | null): { fromVersion: number; count: number } | null {
  if (!plan) return null;
  const plans = plansOf(s, plan.scenarioId);
  const prev = plans[plans.indexOf(plan) - 1];
  if (!prev || prev.status !== 'SUPERSEDED' || prev.votes.length === 0) return null;
  return { fromVersion: prev.version, count: prev.votes.length };
}

// ── departments (Mode Board) ──
export interface DeptView {
  dept: DepartmentId;
  selectedMode: string | null;
  requestedMode: string | null;
  stance: PublicState['agents'][DepartmentId]['stance'];
  returns: Commitment[];
  acceptedReturnOwners: number;
  conflicts: string[];
  vote: Vote | null;
}

const COUNTING = ['ACCEPTED', 'ACTIVE'];

export function deptView(s: PublicState, plan: Plan | null, sc: Scenario | null, dept: DepartmentId, messages: CouncilMessage[]): DeptView {
  const agent = s.agents[dept];
  const selected = plan?.selections[dept] ?? null;
  const returns = plan ? s.commitments.filter((c) => c.beneficiary === dept && plan.commitmentIds.includes(c.id)) : [];
  const acceptedReturnOwners = new Set(returns.filter((c) => COUNTING.includes(c.status)).map((c) => c.owner)).size;
  const conflicts: string[] = [];
  if (plan && selected && isModeId(selected)) {
    const scenarioOfPlan = sc ?? s.scenarios.find((x) => x.id === plan.scenarioId) ?? null;
    if (scenarioOfPlan) {
      const cap = capOf(scenarioOfPlan.pool, scenarioOfPlan.reserveRequirements);
      const mode = getMode(selected);
      for (const k of RESOURCE_KEYS) {
        const overflow = plan.totals[k] - cap[k];
        if (overflow > 0 && mode.resources[k] > 0) conflicts.push(`Contributes ${mode.resources[k]} to ${RESOURCE_LABEL[k].name} overflow (+${overflow})`);
      }
      if (scenarioOfPlan.forbiddenModes.includes(selected as never)) conflicts.push(`${selected} is forbidden in ${scenarioOfPlan.id}`);
    }
    if (plan.sacrifices.includes(dept) && acceptedReturnOwners < plan.policy.requiredReturnCommitments) {
      conflicts.push(`Sacrifice needs ${plan.policy.requiredReturnCommitments} accepted returns from different agents (has ${acceptedReturnOwners})`);
    }
  }
  if (sc) {
    for (const m of messages) {
      if (m.scenarioId !== sc.id || m.round !== sc.round || m.type !== 'OBJECTION' || m.from === dept) continue;
      if (m.to !== 'ALL' && m.to.includes(dept)) conflicts.push(`Objection from ${m.from}: ${m.summary}`);
    }
  }
  return {
    dept,
    selectedMode: selected,
    requestedMode: agent.requestedMode,
    stance: agent.stance && (!sc || agent.stance.scenarioId === sc.id) ? agent.stance : null,
    returns,
    acceptedReturnOwners,
    conflicts,
    vote: votesFor(plan)[dept] ?? null,
  };
}

// ── resources (Mission Control gauges) ──
export interface ResourceRow {
  key: ResourceKey;
  available: number; // the pool
  cap: number; // pool minus required reserve
  reserveRequired: number;
  used: number;
  over: number;
  leftover: number;
  segments: { dept: DepartmentId; mode: string; value: number }[];
  requestedUsed: number | null;
}

export function requestedSelections(s: PublicState): Selections | null {
  const sel: Partial<Selections> = {};
  for (const d of DEPARTMENT_IDS) {
    const m = s.agents[d].requestedMode;
    if (!m) return null;
    sel[d] = m;
  }
  return sel as Selections;
}

export function resourceRows(plan: Plan | null, sc: Scenario, requested: Selections | null): ResourceRow[] {
  const cap = capOf(sc.pool, sc.reserveRequirements);
  const requestedTotals = requested ? selectionTotals(requested).totals : null;
  return RESOURCE_KEYS.map((k) => {
    const used = plan ? plan.totals[k] : 0;
    return {
      key: k,
      available: sc.pool[k],
      cap: cap[k],
      reserveRequired: sc.reserveRequirements[k] ?? 0,
      used,
      over: Math.max(0, used - cap[k]),
      leftover: Math.max(0, cap[k] - used),
      segments: plan ? DEPARTMENT_IDS.map((d) => ({ dept: d, mode: plan.selections[d], value: getMode(plan.selections[d]).resources[k] })) : [],
      requestedUsed: requestedTotals && (!plan || requestedTotals[k] !== used) ? requestedTotals[k] : null,
    };
  });
}

export function limitsOf(sc: Scenario): { riskLimit: number; maxSacrifices: number } {
  return {
    riskLimit: Math.min(sc.policy.riskLimit, sc.riskCap ?? Infinity),
    maxSacrifices: Math.min(sc.policy.maxSacrifices, sc.maxSacrificesCap ?? Infinity),
  };
}

// ── protocol ──
export const PROTOCOL_STEPS = ['Publish', 'Request', 'Find conflicts', 'Negotiate', 'Draft', 'Validate & vote', 'Approve'] as const;

/** Map the server phase and round to the PDF's seven protocol steps (1–7; 0 = idle). */
export function phaseStep(run: RunState, messages: CouncilMessage[]): number {
  const { phase, round, scenarioId } = run;
  const drafted = messages.some((m) => m.scenarioId === scenarioId && m.round === round && m.type === 'PLAN_DRAFT' && m.source !== 'DETERMINISTIC');
  switch (phase) {
    case 'EVENT_INTAKE':
    case 'REVIEW':
      return 1;
    case 'BRIEFING':
      return round <= 1 ? 1 : 4;
    case 'POSITIONS':
      return round <= 1 ? 2 : 4;
    case 'CONSENT':
      return 4;
    case 'SYNTHESIS':
      return drafted || round > 1 ? 5 : 3;
    case 'VALIDATION':
      return drafted || round > 1 ? 6 : 3;
    case 'VOTING':
      return 6;
    case 'DECISION':
    case 'DONE':
      return 7;
    default:
      return 0;
  }
}

// ── badges ──
export function modeIndicator(s: PublicState, messages: CouncilMessage[], now: number): { label: string; tone: Tone; detail: string } {
  if (s.config.mode === 'offline') return { label: 'OFFLINE · rule-based', tone: 'amber', detail: 'No OpenAI key: every agent message is a labeled rule-based FALLBACK.' };
  const recent = [...messages].reverse().find((m) => m.subtype === 'FALLBACK_NOTICE');
  if (recent && now - Date.parse(recent.createdAt) < 60_000) return { label: 'DEGRADED · fallback active', tone: 'amber', detail: recent.summary };
  return { label: `LIVE · ${s.config.models.commander}`, tone: 'success', detail: `Commander ${s.config.models.commander} · departments ${s.config.models.departments} · fallback ${s.config.models.fallback}` };
}

export function storageBadge(st: StorageStatus): { label: string; tone: Tone; detail: string } {
  const detail = [
    st.driver === 'supabase' ? `Supabase project ${st.project ?? '?'}` : 'Local file store',
    `instance ${st.instanceId}`,
    st.lastSyncAt ? `last sync ${new Date(st.lastSyncAt).toLocaleTimeString()}` : null,
    Object.keys(st.rowsWritten).length ? `rows written ${Object.values(st.rowsWritten).reduce((a, b) => a + (b ?? 0), 0)}` : null,
    st.leaseWarning,
  ]
    .filter(Boolean)
    .join(' · ');
  if (st.driver === 'file' || st.state === 'LOCAL_ONLY') return { label: 'DB · local file store', tone: 'muted', detail };
  switch (st.state) {
    case 'SYNCED':
      return { label: 'DB · Supabase ✓', tone: 'success', detail };
    case 'SYNCING':
      return { label: `DB · syncing (${st.pendingRows})`, tone: 'info', detail };
    case 'DEGRADED':
      return { label: `DB · retrying — ${st.pendingRows} pending, safe locally`, tone: 'amber', detail };
    case 'ERROR':
      return { label: `DB · error: ${st.lastError?.hint ?? 'unknown'}`, tone: 'danger', detail };
    default:
      return { label: 'DB', tone: 'muted', detail };
  }
}

export function runStatusLabel(s: PublicState, sc: Scenario | null): { label: string; tone: Tone } {
  if (s.run.status === 'IDLE' && (!sc || sc.status === 'PENDING')) return { label: 'IDLE', tone: 'muted' };
  if (s.run.status === 'AWAITING_COUNTERSIGN') return { label: 'AWAITING COUNTERSIGN', tone: 'amber' };
  if (sc?.status === 'NEGOTIATING' || s.run.status === 'RUNNING') return { label: 'NEGOTIATING', tone: 'mars' };
  if (sc?.outcome) return { label: sc.outcome, tone: sc.outcome === 'APPROVED' ? 'success' : sc.outcome === 'INFEASIBLE' ? 'danger' : sc.outcome === 'INTERRUPTED' ? 'stale' : 'amber' };
  return { label: s.run.status, tone: 'muted' };
}

export const deptLabel = (d: DepartmentId) => DEPARTMENT_LABEL[d];

export function vectorFromPartial(v: Partial<ResourceVector>): ResourceVector {
  return { power: v.power ?? 0, water: v.water ?? 0, oxygen: v.oxygen ?? 0, robot: v.robot ?? 0, bandwidth: v.bandwidth ?? 0 };
}
