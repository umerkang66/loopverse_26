import 'server-only';
import {
  AGENT_IDS,
  type AgentId,
  type AgentState,
  type Commitment,
  type CouncilMessage,
  type DbTable,
  type EventRecord,
  type Plan,
  type Scenario,
  type SessionState,
  type ValidationReport,
  type Vote,
} from '@/domain/types';
import { sessionSummary } from '../store/summary';
import type {
  AgentStateRow,
  AnyRow,
  CommitmentRow,
  EventRow,
  InstanceRow,
  MemoryRow,
  MessageRow,
  PlanRow,
  RowsByTable,
  ScenarioRow,
  SessionRow,
  ValidationRow,
  VoteRow,
} from './rows';

// ── SessionState → rows ──

export function sessionRow(s: SessionState, status: 'active' | 'archived' = 'active'): SessionRow {
  return {
    id: s.id,
    instance_id: s.instanceId,
    scenario_config_id: s.scenarioConfigId,
    catalog_hash: s.catalogHash,
    mode: s.config.mode,
    status,
    config: s.config,
    run: s.run,
    counters: s.counters,
    plan_in_force_version: s.planInForceVersion,
    summary: sessionSummary(s),
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  };
}

export function instanceRow(instanceId: string, currentSessionId: string | null, leaseOwner: string | null, now = new Date()): InstanceRow {
  return {
    instance_id: instanceId,
    current_session_id: currentSessionId,
    lease_owner: leaseOwner,
    lease_expires_at: leaseOwner ? new Date(now.getTime() + 30_000).toISOString() : null,
    updated_at: now.toISOString(),
  };
}

export function scenarioRow(s: SessionState, sc: Scenario): ScenarioRow {
  return {
    session_id: s.id,
    scenario_id: sc.id,
    idx: sc.index,
    kind: sc.kind,
    title: sc.title,
    status: sc.status,
    outcome: sc.outcome,
    approved_plan_version: sc.approvedPlanVersion,
    started_at: sc.startedAt,
    resolved_at: sc.resolvedAt,
    data: sc,
    updated_at: s.updatedAt,
  };
}

export function eventRow(s: SessionState, e: EventRecord): EventRow {
  return {
    session_id: s.id,
    event_id: e.id,
    scenario_id: e.scenarioId,
    title: e.interpretation.title,
    source: e.interpretation.source,
    received_at: e.receivedAt,
    pool_before: e.poolBefore,
    pool_after: e.poolAfter,
    interpretation: e.interpretation,
  };
}

export function planRow(s: SessionState, p: Plan): PlanRow {
  const { validations: _validations, votes: _votes, ...rest } = p;
  return {
    session_id: s.id,
    version: p.version,
    scenario_id: p.scenarioId,
    round: p.round,
    hash: p.hash,
    label: p.label,
    status: p.status,
    life_support_mode: p.selections.LIFE_SUPPORT,
    medical_mode: p.selections.MEDICAL,
    food_mode: p.selections.FOOD,
    engineering_mode: p.selections.ENGINEERING,
    risk: p.risk,
    sacrifices: p.sacrifices,
    commitment_ids: p.commitmentIds,
    totals: p.totals,
    reserve: p.reserve,
    policy: p.policy,
    pool_snapshot: p.poolSnapshot,
    diff: p.diff,
    rationale: p.rationale,
    status_reason: p.statusReason,
    data: rest,
    created_at: p.createdAt,
    updated_at: s.updatedAt,
  };
}

export function validationRow(s: SessionState, p: Plan, reportNo: number): ValidationRow | null {
  const report = p.validations[reportNo];
  if (!report) return null;
  return {
    session_id: s.id,
    plan_version: p.version,
    report_no: reportNo,
    stage: report.stage,
    status: report.status,
    plan_hash: report.planHash,
    failed_checks: report.checks.filter((c) => c.status === 'FAIL').map((c) => c.id),
    report,
    evaluated_at: report.evaluatedAt,
  };
}

export function voteRow(s: SessionState, v: Vote): VoteRow {
  return {
    session_id: s.id,
    vote_id: v.id,
    plan_version: v.planVersion,
    plan_hash: v.planHash,
    agent_id: v.agentId,
    decision: v.decision,
    reason: v.reason,
    conditions: v.conditionsForAccept,
    round: v.round,
    source: v.source,
    created_at: v.createdAt,
  };
}

export function commitmentRow(s: SessionState, c: Commitment): CommitmentRow {
  return {
    session_id: s.id,
    commitment_id: c.id,
    scenario_id: c.scenarioId,
    owner: c.owner,
    beneficiary: c.beneficiary,
    kind: c.kind,
    resource: c.resource,
    amount: c.amount,
    promise: c.promise,
    status: c.status,
    data: c,
    updated_at: s.updatedAt,
  };
}

export function messageRow(s: SessionState, m: CouncilMessage): MessageRow {
  return {
    session_id: s.id,
    seq: m.seq,
    message_id: m.id,
    scenario_id: m.scenarioId,
    round: m.round,
    phase: m.phase,
    from_actor: m.from,
    to_actors: m.to === 'ALL' ? ['ALL'] : m.to,
    type: m.type,
    subtype: m.subtype,
    summary: m.summary,
    body: m.body,
    plan_version: m.planVersion,
    turn_id: m.turnId,
    source: m.source,
    model: m.meta?.model ?? null,
    latency_ms: m.meta?.latencyMs ?? null,
    trace_id: m.meta?.traceId ?? null,
    data: m.data,
    meta: m.meta,
    created_at: m.createdAt,
  };
}

export function agentStateRow(s: SessionState, agentId: AgentId): AgentStateRow {
  const { sessionItems: _items, ...state } = s.agents[agentId];
  return { session_id: s.id, agent_id: agentId, state, updated_at: s.updatedAt };
}

export function memoryRow(s: SessionState, agentId: AgentId, itemNo: number): MemoryRow | null {
  const item = s.agents[agentId].sessionItems[itemNo];
  if (item === undefined) return null;
  return { session_id: s.id, agent_id: agentId, item_no: itemNo, item, created_at: s.updatedAt };
}

// ── dirty keys ↔ rows ──

export function allKeys(s: SessionState): Record<DbTable, string[]> {
  return {
    ares_sessions: [s.id],
    ares_instances: [s.instanceId],
    ares_scenarios: s.scenarios.map((sc) => sc.id),
    ares_events: s.events.map((e) => e.id),
    ares_plans: s.plans.map((p) => String(p.version)),
    ares_plan_validations: s.plans.flatMap((p) => p.validations.map((_, i) => `${p.version}:${i}`)),
    ares_votes: s.plans.flatMap((p) => p.votes.map((v) => v.id)),
    ares_commitments: s.commitments.map((c) => c.id),
    ares_messages: s.messages.map((m) => String(m.seq)),
    ares_agent_states: [...AGENT_IDS],
    ares_agent_memory: AGENT_IDS.flatMap((a) => s.agents[a].sessionItems.map((_, i) => `${a}:${i}`)),
  };
}

/** Build the rows for `keys` of `table` from the CURRENT state (so many dirties coalesce into one row). */
export function rowsFor(table: DbTable, keys: readonly string[], s: SessionState, leaseOwner: string | null): AnyRow[] {
  const rows: AnyRow[] = [];
  for (const key of keys) {
    let row: AnyRow | null | undefined;
    switch (table) {
      case 'ares_sessions':
        row = key === s.id ? sessionRow(s) : null;
        break;
      case 'ares_instances':
        row = key === s.instanceId ? instanceRow(s.instanceId, s.id, leaseOwner) : null;
        break;
      case 'ares_scenarios': {
        const sc = s.scenarios.find((x) => x.id === key);
        row = sc ? scenarioRow(s, sc) : null;
        break;
      }
      case 'ares_events': {
        const e = s.events.find((x) => x.id === key);
        row = e ? eventRow(s, e) : null;
        break;
      }
      case 'ares_plans': {
        const p = s.plans.find((x) => String(x.version) === key);
        row = p ? planRow(s, p) : null;
        break;
      }
      case 'ares_plan_validations': {
        const [version, no] = key.split(':');
        const p = s.plans.find((x) => String(x.version) === version);
        row = p ? validationRow(s, p, Number(no)) : null;
        break;
      }
      case 'ares_votes': {
        const v = s.plans.flatMap((p) => p.votes).find((x) => x.id === key);
        row = v ? voteRow(s, v) : null;
        break;
      }
      case 'ares_commitments': {
        const c = s.commitments.find((x) => x.id === key);
        row = c ? commitmentRow(s, c) : null;
        break;
      }
      case 'ares_messages': {
        const m = s.messages.find((x) => String(x.seq) === key);
        row = m ? messageRow(s, m) : null;
        break;
      }
      case 'ares_agent_states':
        row = (AGENT_IDS as readonly string[]).includes(key) ? agentStateRow(s, key as AgentId) : null;
        break;
      case 'ares_agent_memory': {
        const [agentId, no] = key.split(':');
        row = (AGENT_IDS as readonly string[]).includes(agentId ?? '') ? memoryRow(s, agentId as AgentId, Number(no)) : null;
        break;
      }
    }
    if (row) rows.push(row);
  }
  return rows;
}

export function toRows(s: SessionState, leaseOwner: string | null = null): RowsByTable {
  const keys = allKeys(s);
  const out = {} as Record<DbTable, AnyRow[]>;
  for (const table of Object.keys(keys) as DbTable[]) out[table] = rowsFor(table, keys[table], s, leaseOwner);
  return out as unknown as RowsByTable;
}

// ── rows → SessionState ──

export function fromRows(rows: Omit<RowsByTable, 'ares_instances'>): SessionState {
  const session = rows.ares_sessions[0];
  if (!session) throw new Error('fromRows: missing session row');
  const validations = new Map<number, ValidationRow[]>();
  for (const v of rows.ares_plan_validations) validations.set(v.plan_version, [...(validations.get(v.plan_version) ?? []), v]);
  const votes = new Map<number, VoteRow[]>();
  for (const v of rows.ares_votes) votes.set(v.plan_version, [...(votes.get(v.plan_version) ?? []), v]);
  const voteOrder = (id: string) => Number.parseInt(id.replace(/^V-/, ''), 10) || 0;

  const plans: Plan[] = [...rows.ares_plans]
    .sort((a, b) => a.version - b.version)
    .map((row) => ({
      ...(row.data as Omit<Plan, 'validations' | 'votes'>),
      validations: (validations.get(row.version) ?? []).sort((a, b) => a.report_no - b.report_no).map((v) => v.report as ValidationReport),
      votes: (votes.get(row.version) ?? [])
        .sort((a, b) => voteOrder(a.vote_id) - voteOrder(b.vote_id))
        .map(
          (v): Vote => ({
            id: v.vote_id,
            agentId: v.agent_id as Vote['agentId'],
            planVersion: v.plan_version,
            planHash: v.plan_hash,
            decision: v.decision as Vote['decision'],
            reason: v.reason,
            conditionsForAccept: (v.conditions as string[]) ?? [],
            round: v.round,
            source: v.source as Vote['source'],
            createdAt: new Date(v.created_at).toISOString(),
          }),
        ),
    }));

  const messages: CouncilMessage[] = [...rows.ares_messages]
    .sort((a, b) => a.seq - b.seq)
    .map((m) => ({
      id: m.message_id,
      seq: m.seq,
      scenarioId: m.scenario_id,
      round: m.round,
      phase: m.phase as CouncilMessage['phase'],
      from: m.from_actor as CouncilMessage['from'],
      to: m.to_actors.length === 1 && m.to_actors[0] === 'ALL' ? 'ALL' : (m.to_actors as AgentId[]),
      type: m.type as CouncilMessage['type'],
      subtype: m.subtype,
      summary: m.summary,
      body: m.body,
      planVersion: m.plan_version,
      data: (m.data as Record<string, unknown>) ?? {},
      turnId: m.turn_id,
      source: m.source as CouncilMessage['source'],
      meta: (m.meta as CouncilMessage['meta']) ?? null,
      createdAt: new Date(m.created_at).toISOString(),
    }));

  const memory = new Map<string, MemoryRow[]>();
  for (const r of rows.ares_agent_memory) memory.set(r.agent_id, [...(memory.get(r.agent_id) ?? []), r]);
  const agents = {} as Record<AgentId, AgentState>;
  for (const row of rows.ares_agent_states) {
    const id = row.agent_id as AgentId;
    agents[id] = {
      ...(row.state as Omit<AgentState, 'sessionItems'>),
      sessionItems: (memory.get(id) ?? []).sort((a, b) => a.item_no - b.item_no).map((r) => r.item),
    };
  }

  return {
    id: session.id,
    instanceId: session.instance_id,
    createdAt: new Date(session.created_at).toISOString(),
    updatedAt: new Date(session.updated_at).toISOString(),
    config: session.config as SessionState['config'],
    scenarioConfigId: session.scenario_config_id,
    catalogHash: session.catalog_hash,
    scenarios: [...rows.ares_scenarios].sort((a, b) => a.idx - b.idx).map((r) => r.data as Scenario),
    events: rows.ares_events.map(
      (r): EventRecord => ({
        id: r.event_id,
        scenarioId: r.scenario_id,
        receivedAt: new Date(r.received_at).toISOString(),
        interpretation: r.interpretation as EventRecord['interpretation'],
        poolBefore: r.pool_before as EventRecord['poolBefore'],
        poolAfter: r.pool_after as EventRecord['poolAfter'],
      }),
    ).sort((a, b) => (Number(a.id.replace(/^EV-/, '')) || 0) - (Number(b.id.replace(/^EV-/, '')) || 0)),
    plans,
    commitments: [...rows.ares_commitments]
      .map((r) => r.data as Commitment)
      .sort((a, b) => (Number(a.id.replace(/^C-/, '')) || 0) - (Number(b.id.replace(/^C-/, '')) || 0)),
    messages,
    agents,
    run: session.run as SessionState['run'],
    planInForceVersion: session.plan_in_force_version,
    counters: session.counters as SessionState['counters'],
  };
}
