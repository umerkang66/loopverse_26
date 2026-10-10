import 'server-only';
import OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { EventForecast } from '@/domain/api';
import { EVENT_PRESETS, INITIAL_POOL, SCENARIO } from '@/domain/scenario';
import {
  AGENT_IDS,
  MODE_IDS,
  RESOURCE_KEYS,
  DEPARTMENT_IDS,
  type CouncilMessage,
  type DbTable,
  type EventEffect,
  type EventInterpretation,
  type PublicState,
  type Scenario,
  type SessionState,
} from '@/domain/types';
import { applyEffects, describeEffect, parseEventInput } from '@/engine/events';
import { feasiblePlans } from '@/engine/optimizer';
import { basePolicy, overridePolicy, type ScenarioConstraints } from '@/engine/policy';
import { isValidPool } from '@/engine/resources';
import { failedChecks, validatePlan } from '@/engine/validator';
import { AgentFactory } from './agents/factory';
import { AgentGateway } from './agents/gateway';
import { initAgentsSdk } from './agents/sdk';
import { AgentSessions } from './agents/sessions';
import { EventBus } from './bus';
import { parseServerEnv, secretValues, type ServerEnv } from './env';
import { sha256 } from './ids';
import { logger, registerRedactions } from './logger';
import { Mutations } from './orchestrator/mutations';
import { NegotiationRunner } from './orchestrator/negotiation';
import { createSession, sessionConfigFrom } from './orchestrator/session-factory';
import { certificateFor } from './orchestrator/view';
import { toPublicState } from './public-state';
import { Persistence } from './store/persistence';
import type { SessionListEntry } from './store/summary';

const log = logger('runtime');

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type { EventForecast };

const EffectSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('RESOURCE_DELTA'), resource: z.enum(RESOURCE_KEYS), value: z.number().min(-999).max(999) }),
  z.object({ type: z.literal('RESOURCE_PERCENT'), resource: z.enum(RESOURCE_KEYS), value: z.number().min(-100).max(500) }),
  z.object({ type: z.literal('RESOURCE_SET'), resource: z.enum(RESOURCE_KEYS), value: z.number().min(0).max(999) }),
  z.object({ type: z.literal('RESERVE_REQUIREMENT'), resource: z.enum(RESOURCE_KEYS), value: z.number().min(0).max(999) }),
  z.object({ type: z.literal('FORBID_MODE'), modeId: z.enum(MODE_IDS), reason: z.string().max(300) }),
  z.object({ type: z.literal('ALLOW_MODE'), modeId: z.enum(MODE_IDS) }),
  z.object({ type: z.literal('RISK_LIMIT'), value: z.number().int().min(4).max(60) }),
  z.object({ type: z.literal('MAX_SACRIFICES'), value: z.number().int().min(0).max(4) }),
  z.object({ type: z.literal('PRIORITY'), department: z.enum(DEPARTMENT_IDS).nullable(), note: z.string().max(400) }),
  z.object({ type: z.literal('INFO'), note: z.string().max(400) }),
]);

export const InterpretationSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().max(2000),
  effects: z.array(EffectSchema).max(12),
  durationHours: z.number().nullable(),
  triggerHour: z.number().nullable(),
  requiresReplan: z.boolean(),
  messageToCommander: z.string().max(1000).nullable(),
  source: z.enum(['DETERMINISTIC', 'LLM', 'HYBRID', 'MANUAL', 'PRESET']),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()),
  assumptions: z.array(z.string()),
  raw: z.unknown(),
});

export const InterpretRequestSchema = z.object({
  kind: z.enum(['json', 'text', 'preset', 'manual']),
  input: z.unknown().optional(),
  presetId: z.string().optional(),
  title: z.string().max(200).optional(),
  effects: z.array(EffectSchema).max(12).optional(),
});
export type InterpretRequest = z.infer<typeof InterpretRequestSchema>;

declare global {
  var __aresRuntime: AresRuntime | undefined;
}

export interface RuntimeOptions {
  env?: Partial<ServerEnv>;
  supabaseClient?: SupabaseClient | null;
  source?: Record<string, string | undefined>;
}

/** The single in-process engine: state, persistence, agents, protocol, and the event stream. */
export class AresRuntime {
  readonly env: ServerEnv;
  readonly bus = new EventBus();
  readonly persistence: Persistence;
  readonly mut: Mutations;
  readonly gateway: AgentGateway;
  readonly runner: NegotiationRunner;
  private readonly sessions = new AgentSessions();
  private state: SessionState | null = null;
  private readonly readyPromise: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private current: { abort: AbortController; done: Promise<void>; scenarioId: string } | null = null;
  private countTimer: NodeJS.Timeout | null = null;
  private modelChecks = new Map<string, { at: number; value: string }>();

  constructor(options: RuntimeOptions = {}) {
    this.env = parseServerEnv(options.source ?? process.env, options.env ?? {});
    registerRedactions(secretValues(this.env));
    initAgentsSdk(this.env);
    this.persistence = new Persistence(this.env, () => this.state, (n) => this.onStorageNotice(n.level, n.text), options.supabaseClient);
    this.mut = new Mutations({
      state: () => this.mustState(),
      bus: this.bus,
      persistence: this.persistence,
      now: () => new Date().toISOString(),
      publicState: () => this.getPublicState(),
    });
    const factory = new AgentFactory(this.env);
    this.gateway = new AgentGateway(this.env, factory, this.sessions, {
      sessionId: () => this.mustState().id,
      sessionItems: (agentId) => this.mustState().agents[agentId].sessionItems,
      onSessionItems: (agentId, items) => this.mut.updateAgent(agentId, (a) => void (a.sessionItems = items)),
      onStats: (agentId, d) =>
        this.mut.updateAgent(agentId, (a) => {
          if (d.llm) a.stats.llmCalls++;
          else a.stats.fallbacks++;
          a.stats.totalLatencyMs += d.latencyMs;
          a.stats.inputTokens += d.inputTokens;
          a.stats.outputTokens += d.outputTokens;
        }),
      onNotice: (level, text) => this.notice(level, text),
    });
    this.runner = new NegotiationRunner({
      state: () => this.mustState(),
      mut: this.mut,
      gateway: this.gateway,
      env: this.env,
      now: () => new Date().toISOString(),
      sha256,
    });
    this.readyPromise = this.boot();
  }

  // ── lifecycle ──
  private async boot(): Promise<void> {
    const result = await this.persistence.boot(() => createSession(this.env, new Date().toISOString()));
    this.state = result.state;
    this.state.config = { ...sessionConfigFrom(this.env), hitl: this.state.config?.hitl ?? sessionConfigFrom(this.env).hitl };
    this.persistence.start(result.restoredFrom);
    for (const note of result.notes) log.warn(note);
    for (const id of AGENT_IDS) if (this.state.agents[id].status === 'THINKING') this.state.agents[id].status = 'IDLE';
    this.state.run.activeAgents = [];
    if (this.state.run.status === 'RUNNING') {
      const sc = this.state.scenarios.find((x) => x.id === this.state!.run.scenarioId);
      if (sc && sc.status === 'NEGOTIATING') {
        this.runner.conclude(sc, 'INTERRUPTED', `Server restarted during round ${sc.round}; negotiation interrupted. Use Resume.`);
      }
      this.mut.setRun({ status: 'INTERRUPTED' });
    }
    log.info(`ready: session ${this.state.id} (${result.restoredFrom}), storage ${this.persistence.driver}, agents ${this.env.mode}`);
    if (this.persistence.driver === 'supabase') {
      this.countTimer = setInterval(() => void this.refreshPersistedCount(), 10_000);
      this.countTimer.unref?.();
    }
    this.mut.publishNow();
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  private mustState(): SessionState {
    if (!this.state) throw new HttpError(503, 'Runtime is still booting');
    return this.state;
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private notice(level: 'info' | 'warning' | 'error' | 'success', text: string): void {
    this.mut.toast(level, text);
    const sc = this.latestScenario();
    if (sc && level !== 'info') this.mut.system(sc, 'FALLBACK_NOTICE', text);
  }

  private onStorageNotice(level: 'info' | 'warning' | 'error' | 'success', text: string): void {
    if (!this.state) return;
    this.mut.toast(level, text);
    this.mut.schedulePublish();
  }

  private async refreshPersistedCount(): Promise<void> {
    if (!this.state) return;
    const before = this.persistence.status().dbMessageCount;
    const count = await this.persistence.refreshDbMessageCount(this.state.id);
    if (count !== before) this.mut.schedulePublish();
  }

  // ── reads ──
  getPublicState(): PublicState {
    return toPublicState(this.mustState(), this.persistence.status());
  }

  getMessages(sinceSeq = 0): CouncilMessage[] {
    return this.mustState().messages.filter((m) => m.seq > sinceSeq);
  }

  getSnapshot(): SessionState {
    return this.mustState();
  }

  latestScenario(): Scenario | undefined {
    const scenarios = this.state?.scenarios ?? [];
    return scenarios[scenarios.length - 1];
  }

  isRunning(): boolean {
    return this.current !== null;
  }

  /** Await the background negotiation (scripts and tests). */
  async waitForIdle(timeoutMs = 600_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.current && Date.now() < deadline) {
      await Promise.race([this.current.done, new Promise((r) => setTimeout(r, 250))]);
    }
  }

  // ── commands ──
  start(input: { resources?: unknown; maxRounds?: number; deadlineSeconds?: number } = {}): Promise<{ sessionId: string; scenarioId: string }> {
    return this.exclusive(async () => {
      await this.ready();
      const s = this.mustState();
      if (s.scenarios.length > 0 || this.current) throw new HttpError(409, 'The crisis has already started — reset to start a new council.');
      const pool = input.resources === undefined ? { ...INITIAL_POOL } : input.resources;
      if (!isValidPool(pool)) throw new HttpError(400, 'resources must hold integers 0–999 for power, water, oxygen, robot, bandwidth');
      const scenario: Scenario = {
        id: 'S0',
        index: 0,
        kind: 'BASELINE',
        title: SCENARIO.title,
        description: SCENARIO.narrative,
        colonyHour: 0,
        eventId: null,
        pool: { ...pool },
        reserveRequirements: {},
        forbiddenModes: [],
        priorities: [],
        policy: basePolicy(),
        overrideAvailable: false,
        riskCap: null,
        maxSacrificesCap: null,
        minRoundsBeforeApproval: SCENARIO.policy.minRoundsBeforeFirstApproval,
        maxRounds: Math.min(12, Math.max(1, Math.round(input.maxRounds ?? this.env.MAX_ROUNDS_BASELINE))),
        deadlineSeconds: input.deadlineSeconds ? Math.min(1800, Math.max(30, Math.round(input.deadlineSeconds))) : null,
        status: 'PENDING',
        outcome: null,
        outcomeReason: null,
        round: 0,
        startedAt: null,
        deadlineAt: null,
        resolvedAt: null,
        approvedPlanVersion: null,
        certificate: null,
        previousPlan: null,
        nextBrief: null,
      };
      this.mut.addScenario(scenario);
      this.launch(scenario.id);
      return { sessionId: s.id, scenarioId: scenario.id };
    });
  }

  /** Pure preview: interpretation + feasibility forecast. Never mutates state. */
  async interpretEvent(request: InterpretRequest): Promise<{ interpretation: EventInterpretation; forecast: EventForecast }> {
    await this.ready();
    let interpretation: EventInterpretation;
    if (request.kind === 'preset') {
      const preset = EVENT_PRESETS.find((p) => p.id === request.presetId);
      if (!preset) throw new HttpError(400, `Unknown preset ${request.presetId}`);
      interpretation = parseEventInput(preset.payload, { source: 'PRESET' });
    } else if (request.kind === 'json') {
      let payload = request.input;
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch {
          throw new HttpError(400, 'The event JSON is not valid JSON.');
        }
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new HttpError(400, 'The event JSON must be an object.');
      interpretation = parseEventInput(payload);
    } else if (request.kind === 'text') {
      if (typeof request.input !== 'string' || !request.input.trim()) throw new HttpError(400, 'Describe the event in words.');
      interpretation = parseEventInput(request.input.slice(0, 4000));
    } else {
      const effects = (request.effects ?? []) as EventEffect[];
      if (effects.length === 0) throw new HttpError(400, 'Add at least one effect.');
      interpretation = {
        title: request.title?.trim() || 'Manual adjustment',
        summary: effects.map((e) => describeEffect(e)).join('; '),
        effects,
        durationHours: null,
        triggerHour: null,
        requiresReplan: true,
        messageToCommander: null,
        source: 'MANUAL',
        confidence: 1,
        warnings: [],
        assumptions: [],
        raw: request.effects,
      };
    }
    return { interpretation, forecast: this.forecast(interpretation) };
  }

  private forecast(interpretation: EventInterpretation): EventForecast {
    const s = this.mustState();
    const prev = this.latestScenario();
    const base = prev ?? {
      pool: { ...INITIAL_POOL },
      reserveRequirements: {},
      forbiddenModes: [],
      riskCap: null,
      maxSacrificesCap: null,
      priorities: [],
      colonyHour: 0,
      index: -1,
    };
    const applied = applyEffects(base, interpretation.effects);
    const constraints: ScenarioConstraints = {
      pool: applied.pool,
      reserveRequirements: applied.reserveRequirements,
      forbiddenModes: applied.forbiddenModes,
      riskCap: applied.riskCap,
      maxSacrificesCap: applied.maxSacrificesCap,
    };
    const feasibleBase = feasiblePlans(constraints, basePolicy()).length;
    const feasibleOverride = feasiblePlans(constraints, overridePolicy()).length;
    let previousPlanWouldBe: EventForecast['previousPlanWouldBe'] = null;
    let previousPlanReasons: string[] = [];
    const inForce = s.planInForceVersion ? s.plans.find((p) => p.version === s.planInForceVersion) : undefined;
    if (inForce) {
      const report = validatePlan({
        selections: inForce.selections,
        scenario: { ...constraints, policy: basePolicy(), colonyHour: base.colonyHour, index: base.index + 1 },
        includedCommitments: s.commitments.filter((c) => inForce.commitmentIds.includes(c.id)),
        stage: 'DRY_RUN',
        now: new Date().toISOString(),
      });
      const broken = failedChecks(report).filter((c) => ['RESOURCES', 'FORBIDDEN_MODES', 'RISK_LIMIT', 'SACRIFICE_LIMIT'].includes(c.id));
      previousPlanWouldBe = broken.length ? 'INVALID' : 'STALE';
      previousPlanReasons = broken.map((c) => c.reason);
    }
    const tempScenario = {
      ...(prev ?? ({} as Scenario)),
      ...constraints,
      kind: 'EVENT' as const,
      overrideAvailable: true,
      policy: basePolicy(),
    } as Scenario;
    return {
      poolBefore: base.pool,
      poolAfter: applied.pool,
      effects: interpretation.effects.map((e) => describeEffect(e, base.pool)),
      feasibleBase,
      feasibleOverride,
      previousPlanWouldBe,
      previousPlanReasons,
      certificate: feasibleBase === 0 && feasibleOverride === 0 ? certificateFor(tempScenario, interpretation.durationHours) : null,
    };
  }

  applyEvent(raw: unknown): Promise<{ scenarioId: string; eventId: string }> {
    return this.exclusive(async () => {
      await this.ready();
      const parsed = InterpretationSchema.safeParse(raw);
      if (!parsed.success) throw new HttpError(400, `Invalid interpretation: ${parsed.error.issues[0]?.message ?? 'bad shape'}`);
      const interpretation = parsed.data as EventInterpretation;
      const prev = this.latestScenario();
      if (!prev) throw new HttpError(409, 'Start the crisis before injecting an event.');
      await this.interruptCurrent(`New event "${interpretation.title}" arrived`);
      const applied = applyEffects(prev, interpretation.effects);
      const eventId = this.mut.nextEventId();
      const index = prev.index + 1;
      const scenario: Scenario = {
        id: `S${index}`,
        index,
        kind: 'EVENT',
        title: interpretation.title,
        description: interpretation.summary,
        colonyHour: interpretation.triggerHour ?? prev.colonyHour + SCENARIO.policy.defaultEventHourStep,
        eventId,
        pool: applied.pool,
        reserveRequirements: applied.reserveRequirements,
        forbiddenModes: applied.forbiddenModes,
        priorities: applied.priorities,
        policy: basePolicy(),
        overrideAvailable: true,
        riskCap: applied.riskCap,
        maxSacrificesCap: applied.maxSacrificesCap,
        minRoundsBeforeApproval: SCENARIO.policy.minRoundsAfterEvent,
        maxRounds: Math.max(SCENARIO.policy.minRoundsAfterEvent, this.env.MAX_ROUNDS_EVENT),
        status: 'PENDING',
        outcome: null,
        outcomeReason: null,
        round: 0,
        startedAt: null,
        deadlineAt: null,
        resolvedAt: null,
        approvedPlanVersion: null,
        certificate: null,
        previousPlan: null,
        nextBrief: null,
      };
      this.mut.addScenario(scenario);
      this.mut.addEvent({ id: eventId, scenarioId: scenario.id, receivedAt: new Date().toISOString(), interpretation, poolBefore: { ...prev.pool }, poolAfter: { ...applied.pool } });
      this.mut.post({
        scenarioId: scenario.id,
        round: 0,
        phase: 'EVENT_INTAKE',
        from: 'SYSTEM',
        type: 'EVENT',
        summary: `⚡ ${interpretation.title}: ${interpretation.effects.filter((e) => e.type !== 'INFO').map((e) => describeEffect(e, prev.pool)).join('; ') || 'no resource change'}`.slice(0, 400),
        body: interpretation.messageToCommander ?? interpretation.summary,
        data: { event: { id: eventId, interpretation, poolBefore: prev.pool, poolAfter: applied.pool }, requiresReplan: interpretation.requiresReplan, notes: applied.notes },
        source: interpretation.source === 'LLM' || interpretation.source === 'HYBRID' ? 'LLM' : 'DETERMINISTIC',
      });
      this.launch(scenario.id);
      return { scenarioId: scenario.id, eventId };
    });
  }

  resume(): Promise<{ scenarioId: string }> {
    return this.exclusive(async () => {
      await this.ready();
      const sc = this.latestScenario();
      if (this.current) throw new HttpError(409, 'A negotiation is already running.');
      if (!sc || sc.status !== 'RESOLVED' || !sc.outcome || !['DEADLOCK', 'TIMEOUT', 'INTERRUPTED'].includes(sc.outcome)) {
        throw new HttpError(409, 'Resume is available after a DEADLOCK, TIMEOUT or INTERRUPTED result.');
      }
      const seconds = sc.kind === 'BASELINE' ? this.env.DEADLINE_BASELINE_SECONDS : this.env.DEADLINE_EVENT_SECONDS;
      this.mut.updateScenario(sc, {
        status: 'NEGOTIATING',
        outcome: null,
        outcomeReason: null,
        resolvedAt: null,
        maxRounds: Math.max(sc.maxRounds, sc.round) + 2,
        deadlineAt: new Date(Date.now() + seconds * 1000).toISOString(),
      });
      this.mut.system(sc, 'RESUMED', `${sc.id} resumed: two more rounds (max ${sc.maxRounds})`);
      this.launch(sc.id);
      return { scenarioId: sc.id };
    });
  }

  reset(input: { hard?: boolean; confirm?: string } = {}): Promise<{ sessionId: string }> {
    return this.exclusive(async () => {
      await this.ready();
      if (input.hard && input.confirm !== 'DELETE') throw new HttpError(400, 'A hard reset requires confirm: "DELETE".');
      await this.interruptCurrent('Council reset by the judge', false);
      const old = this.mustState();
      if (input.hard) await this.persistence.hardReset();
      else await this.persistence.archive(old);
      this.sessions.clear();
      this.state = createSession(this.env, new Date().toISOString());
      this.persistence.markAllDirty();
      this.persistence.scheduleSnapshot();
      await this.persistence.flushNow(3000);
      this.bus.publish({ type: 'session.reset', sessionId: this.state.id });
      this.mut.publishNow();
      return { sessionId: this.state.id };
    });
  }

  countersign(decision: 'COUNTERSIGN' | 'VETO', reason = ''): Promise<{ scenarioId: string }> {
    return this.exclusive(async () => {
      await this.ready();
      const sc = this.latestScenario();
      if (!sc || sc.status !== 'AWAITING_COUNTERSIGN' || !sc.approvedPlanVersion) throw new HttpError(409, 'No plan is awaiting a human countersign.');
      const plan = this.mustState().plans.find((p) => p.version === sc.approvedPlanVersion)!;
      if (decision === 'COUNTERSIGN') {
        this.mut.setPlanStatus(plan, 'RATIFIED');
        this.mut.updateScenario(sc, { status: 'RESOLVED', outcomeReason: `Approved v${plan.version} and countersigned by Mission Control` });
        this.mut.system(sc, 'HUMAN_COUNTERSIGN', `Mission Control countersigned plan v${plan.version}`, reason || 'Countersigned.', {}, 'JUDGE');
        this.mut.setRun({ status: 'COMPLETED' });
      } else {
        if (!reason.trim()) throw new HttpError(400, 'A veto needs a reason.');
        this.mut.setPlanStatus(plan, 'REJECTED', `Vetoed by Mission Control: ${reason}`);
        this.mut.post({ scenarioId: sc.id, round: sc.round, phase: 'DECISION', from: 'JUDGE', type: 'OBJECTION', subtype: 'HUMAN_VETO', summary: `Mission Control VETO of v${plan.version}`, body: reason, planVersion: plan.version, source: 'HUMAN' });
        const previous = [...this.mustState().plans].reverse().find((p) => p.version !== plan.version && (p.status === 'APPROVED' || p.status === 'RATIFIED' || p.status === 'STALE' || p.status === 'INVALID'));
        this.mut.setPlanInForce(previous?.version ?? null);
        const seconds = sc.kind === 'BASELINE' ? this.env.DEADLINE_BASELINE_SECONDS : this.env.DEADLINE_EVENT_SECONDS;
        this.mut.updateScenario(sc, { status: 'NEGOTIATING', outcome: null, outcomeReason: null, approvedPlanVersion: null, resolvedAt: null, maxRounds: sc.round + 2, deadlineAt: new Date(Date.now() + seconds * 1000).toISOString() });
        this.launch(sc.id);
      }
      return { scenarioId: sc.id };
    });
  }

  private async interruptCurrent(reason: string, markScenario = true): Promise<void> {
    const current = this.current;
    if (!current) return;
    current.abort.abort();
    await Promise.race([current.done, new Promise((r) => setTimeout(r, 10_000))]);
    this.current = null;
    if (!markScenario) return;
    const sc = this.mustState().scenarios.find((x) => x.id === current.scenarioId);
    if (sc && (sc.status === 'NEGOTIATING' || sc.status === 'PENDING')) this.runner.conclude(sc, 'INTERRUPTED', reason);
  }

  private launch(scenarioId: string): void {
    const abort = new AbortController();
    const done = this.runner
      .runScenario(scenarioId, abort.signal)
      .catch((err: unknown) => {
        if (abort.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        log.error(`negotiation ${scenarioId} crashed`, err);
        this.mut.setRun({ lastError: message });
        const sc = this.state?.scenarios.find((x) => x.id === scenarioId);
        if (sc && sc.status !== 'RESOLVED') this.runner.conclude(sc, 'INTERRUPTED', `Internal error: ${message.slice(0, 200)}. Use Resume.`);
      })
      .finally(() => {
        if (this.current?.abort === abort) this.current = null;
        if (this.state && this.state.run.status === 'RUNNING') this.mut.setRun({ status: 'COMPLETED' });
        this.mut.publishNow();
      });
    this.current = { abort, done, scenarioId };
  }

  // ── history ──
  async listSessions(): Promise<SessionListEntry[]> {
    await this.ready();
    return this.persistence.listSessions();
  }

  async getSession(id: string): Promise<SessionState | null> {
    await this.ready();
    if (id === this.state?.id) return this.state;
    return this.persistence.getSession(id);
  }

  async exportSession(id?: string): Promise<SessionState> {
    await this.ready();
    if (!id || id === this.state?.id) {
      await this.persistence.flushNow(4000);
      return this.mustState();
    }
    const s = await this.persistence.getSession(id);
    if (!s) throw new HttpError(404, 'Session not found');
    return s;
  }

  // ── health ──
  async health(deep = false): Promise<Record<string, unknown>> {
    await this.ready();
    const s = this.mustState();
    const models = [...new Set([this.env.OPENAI_MODEL_COMMANDER, this.env.OPENAI_MODEL_DEPARTMENTS, this.env.OPENAI_FALLBACK_MODEL])];
    const modelCheck: Record<string, string> = {};
    for (const m of models) modelCheck[m] = this.env.mode === 'live' ? await this.checkModel(m) : 'unchecked';
    let rowCounts: Partial<Record<DbTable, number>> | null = null;
    if (deep) {
      rowCounts = await this.persistence.deepCounts(s.id).catch(() => null);
      await this.refreshPersistedCount();
    }
    return {
      ok: true,
      mode: this.gateway.mode,
      circuitOpen: this.gateway.circuitOpen(),
      models: { commander: this.env.OPENAI_MODEL_COMMANDER, departments: this.env.OPENAI_MODEL_DEPARTMENTS, fallback: this.env.OPENAI_FALLBACK_MODEL },
      modelCheck,
      tracing: this.env.mode === 'live' && this.env.OPENAI_TRACING === 'on',
      storage: this.persistence.status(),
      rowCounts,
      memory: { messages: s.messages.length, plans: s.plans.length, votes: s.plans.reduce((n, p) => n + p.votes.length, 0), commitments: s.commitments.length },
      sessionId: s.id,
      instanceId: this.env.ARES_INSTANCE_ID,
      dataDir: this.persistence.snapshot.dir,
      run: s.run,
      judgeCodeRequired: Boolean(this.env.JUDGE_ACCESS_CODE),
    };
  }

  private async checkModel(model: string): Promise<string> {
    const cached = this.modelChecks.get(model);
    if (cached && Date.now() - cached.at < 600_000) return cached.value;
    let value = 'error';
    try {
      const client = new OpenAI({ apiKey: this.env.OPENAI_API_KEY, timeout: 8000, maxRetries: 0 });
      await client.models.retrieve(model);
      value = 'ok';
    } catch (err) {
      const status = (err as { status?: number }).status;
      value = status === 404 ? 'not_found' : status === 401 ? 'unauthorized' : 'error';
    }
    this.modelChecks.set(model, { at: Date.now(), value });
    return value;
  }

  async dispose(): Promise<void> {
    if (this.countTimer) clearInterval(this.countTimer);
    await this.interruptCurrent('Shutdown', true).catch(() => undefined);
    await this.persistence.flushNow(3000).catch(() => undefined);
    this.persistence.stop();
  }
}

/** The process-wide singleton (globalThis survives HMR and separate route bundles). */
export function getRuntime(): AresRuntime {
  if (!globalThis.__aresRuntime) {
    globalThis.__aresRuntime = new AresRuntime();
    const flush = () => void globalThis.__aresRuntime?.persistence.flushNow(3000);
    process.once('SIGTERM', flush);
    process.once('SIGINT', flush);
  }
  return globalThis.__aresRuntime;
}
