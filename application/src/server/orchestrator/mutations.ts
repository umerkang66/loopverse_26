import 'server-only';
import type {
  ActorId,
  AgentId,
  AgentState,
  AgentStatus,
  Commitment,
  CommitmentStatus,
  CouncilMessage,
  DbTable,
  EventRecord,
  Phase,
  Plan,
  PlanStatus,
  PublicState,
  RunState,
  Scenario,
  SessionState,
  ValidationReport,
  Vote,
} from '@/domain/types';
import type { EventBus } from '../bus';
import { messageId } from '../ids';
import type { Persistence } from '../store/persistence';

export type NewMessage = Pick<CouncilMessage, 'scenarioId' | 'round' | 'phase' | 'from' | 'type' | 'summary' | 'body'> &
  Partial<Pick<CouncilMessage, 'to' | 'subtype' | 'planVersion' | 'data' | 'turnId' | 'source' | 'meta'>>;

export interface MutationDeps {
  state(): SessionState;
  bus: EventBus;
  persistence: Persistence;
  now(): string;
  publicState(): PublicState;
}

/** The ONLY place session state changes: every mutation streams, marks rows dirty for Supabase, and snapshots. */
export class Mutations {
  private publishTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: MutationDeps) {}

  private get s(): SessionState {
    return this.deps.state();
  }

  now(): string {
    return this.deps.now();
  }

  private touch(...keys: [DbTable, string][]): void {
    const s = this.s;
    s.updatedAt = this.deps.now();
    for (const [table, key] of keys) this.deps.persistence.markDirty(table, key);
    this.deps.persistence.markDirty('ares_sessions', s.id);
    this.deps.persistence.scheduleSnapshot();
    this.schedulePublish();
  }

  /** Trailing throttle: at most ~8 full-state broadcasts per second. Messages stream individually. */
  schedulePublish(): void {
    if (this.publishTimer) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      this.publishNow();
    }, 120);
    this.publishTimer.unref?.();
  }

  publishNow(): void {
    if (this.publishTimer) {
      clearTimeout(this.publishTimer);
      this.publishTimer = null;
    }
    this.deps.bus.publish({ type: 'state.updated', state: this.deps.publicState() });
  }

  toast(level: 'info' | 'success' | 'warning' | 'error', text: string): void {
    this.deps.bus.publish({ type: 'toast', level, text });
  }

  // ── messages ──
  post(input: NewMessage): CouncilMessage {
    const s = this.s;
    const seq = ++s.counters.seq;
    const message: CouncilMessage = {
      id: messageId(seq),
      seq,
      scenarioId: input.scenarioId,
      round: input.round,
      phase: input.phase,
      from: input.from,
      to: input.to ?? 'ALL',
      type: input.type,
      subtype: input.subtype ?? null,
      summary: input.summary,
      body: input.body,
      planVersion: input.planVersion ?? null,
      data: input.data ?? {},
      turnId: input.turnId ?? null,
      source: input.source ?? 'DETERMINISTIC',
      meta: input.meta ?? null,
      createdAt: this.deps.now(),
    };
    s.messages.push(message);
    this.deps.bus.publish({ type: 'message.created', message });
    this.touch(['ares_messages', String(seq)]);
    return message;
  }

  system(scenario: Scenario, subtype: string, summary: string, body = summary, data: Record<string, unknown> = {}, from: ActorId = 'SYSTEM'): CouncilMessage {
    return this.post({
      scenarioId: scenario.id,
      round: scenario.round,
      phase: this.s.run.phase,
      from,
      type: 'SYSTEM',
      subtype,
      summary,
      body,
      data,
      planVersion: this.latestPlanVersion(scenario.id),
      source: from === 'JUDGE' ? 'HUMAN' : 'DETERMINISTIC',
    });
  }

  nextTurnId(): string {
    this.s.counters.turn++;
    this.touch();
    return `T-${this.s.counters.turn}`;
  }

  // ── run state ──
  setRun(patch: Partial<RunState>): void {
    Object.assign(this.s.run, patch);
    this.touch();
  }

  setPhase(phase: Phase): void {
    this.s.run.phase = phase;
    this.touch();
  }

  // ── agents ──
  setAgentStatus(agentId: AgentId, status: AgentStatus): void {
    const s = this.s;
    s.agents[agentId].status = status;
    const active = new Set(s.run.activeAgents);
    if (status === 'THINKING') active.add(agentId);
    else active.delete(agentId);
    s.run.activeAgents = [...active];
    this.deps.bus.publish({ type: 'agent.status', agentId, status, phase: s.run.phase });
    this.touch(['ares_agent_states', agentId]);
  }

  updateAgent(agentId: AgentId, update: (agent: AgentState) => void): void {
    const agent = this.s.agents[agentId];
    const before = agent.sessionItems.length;
    update(agent);
    const keys: [DbTable, string][] = [['ares_agent_states', agentId]];
    for (let i = before; i < agent.sessionItems.length; i++) keys.push(['ares_agent_memory', `${agentId}:${i}`]);
    this.touch(...keys);
  }

  // ── scenarios ──
  addScenario(scenario: Scenario): Scenario {
    this.s.scenarios.push(scenario);
    this.touch(['ares_scenarios', scenario.id]);
    return scenario;
  }

  updateScenario(scenario: Scenario, patch: Partial<Scenario>): void {
    Object.assign(scenario, patch);
    this.touch(['ares_scenarios', scenario.id]);
  }

  // ── events ──
  addEvent(record: EventRecord): void {
    this.s.events.push(record);
    this.touch(['ares_events', record.id]);
  }

  nextEventId(): string {
    this.s.counters.event++;
    return `EV-${this.s.counters.event}`;
  }

  // ── plans ──
  latestPlanVersion(scenarioId: string): number | null {
    const plans = this.s.plans.filter((p) => p.scenarioId === scenarioId);
    return plans.length ? plans[plans.length - 1]!.version : null;
  }

  nextPlanVersion(): number {
    this.s.counters.plan++;
    return this.s.counters.plan;
  }

  addPlan(plan: Plan): Plan {
    this.s.plans.push(plan);
    this.touch(['ares_plans', String(plan.version)]);
    return plan;
  }

  setPlanStatus(plan: Plan, status: PlanStatus, reason: string | null = null): void {
    plan.status = status;
    plan.statusReason = reason;
    this.touch(['ares_plans', String(plan.version)]);
  }

  addValidation(plan: Plan, report: ValidationReport): void {
    plan.validations.push(report);
    this.touch(['ares_plans', String(plan.version)], ['ares_plan_validations', `${plan.version}:${plan.validations.length - 1}`]);
  }

  nextVoteId(): string {
    this.s.counters.vote++;
    return `V-${this.s.counters.vote}`;
  }

  addVote(plan: Plan, vote: Vote): void {
    plan.votes.push(vote);
    this.touch(['ares_plans', String(plan.version)], ['ares_votes', vote.id]);
  }

  setPlanInForce(version: number | null): void {
    this.s.planInForceVersion = version;
    this.touch();
  }

  // ── commitments ──
  nextCommitmentId(): string {
    this.s.counters.commitment++;
    return `C-${this.s.counters.commitment}`;
  }

  addCommitment(commitment: Commitment): Commitment {
    this.s.commitments.push(commitment);
    this.touch(['ares_commitments', commitment.id]);
    return commitment;
  }

  setCommitmentStatus(commitment: Commitment, status: CommitmentStatus, by: ActorId, reason: string): void {
    commitment.status = status;
    commitment.history.push({ at: this.deps.now(), status, by, reason });
    this.touch(['ares_commitments', commitment.id]);
  }
}
