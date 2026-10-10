import 'server-only';
import { withTrace } from '@openai/agents';
import { PROFILES } from '@/domain/scenario';
import {
  DEPARTMENT_IDS,
  type DepartmentId,
  type Plan,
  type Scenario,
  type ScenarioOutcome,
  type ValidationReport,
  type Vote,
} from '@/domain/types';
import { restrictedModeOf, selectionTotals } from '@/engine/catalog';
import { canInvokeOverride, overridePolicy } from '@/engine/policy';
import { failedChecks } from '@/engine/validator';
import { tally } from '@/engine/votes';
import { fallbackConsent, fallbackDepartmentTurn, fallbackBallot } from '../agents/fallback/department';
import { fallbackBriefing, fallbackDecision, fallbackSynthesis } from '../agents/fallback/commander';
import { ballotIssues, synthesisIssues } from '../agents/guardrails';
import { commanderPacket, departmentPacket, planLine, reportLine, commitmentLine } from '../agents/packet';
import type {
  BallotOutput,
  BriefingOutput,
  ConsentOutput,
  DecisionOutput,
  DepartmentTurnOutput,
  SynthesisOutput,
} from '../agents/schemas';
import { toOutputSchemaRecord } from '../export/output-schema';
import { logger } from '../logger';
import { applyConsent, applyDepartmentTurn, registerOffer, type OfferInput, type TurnEnvelope } from './apply-turn';
import { agentContext, throwIfAborted, type RunnerDeps, type RunSignals } from './deps';
import { openEventScenario } from './event-open';
import { createOrReusePlan, validateAndRecord } from './plan-ops';
import { buildView, certificateFor, distinctOwners } from './view';

const log = logger('negotiation');

/** The protocol: 7-phase rounds mirroring the PDF's 7 steps, min/max rounds, deadlines, and the approval gate. */
export class NegotiationRunner {
  constructor(private readonly deps: RunnerDeps) {}

  private get s() {
    return this.deps.state();
  }

  private scenario(id: string): Scenario {
    const sc = this.s.scenarios.find((x) => x.id === id);
    if (!sc) throw new Error(`Unknown scenario ${id}`);
    return sc;
  }

  private now() {
    return this.deps.now();
  }

  async runScenario(scenarioId: string, abort: AbortSignal): Promise<void> {
    const sc = this.scenario(scenarioId);
    const { mut, env } = this.deps;
    if (sc.status === 'PENDING') {
      const seconds = sc.deadlineSeconds ?? (sc.kind === 'BASELINE' ? env.DEADLINE_BASELINE_SECONDS : env.DEADLINE_EVENT_SECONDS);
      mut.updateScenario(sc, {
        status: 'NEGOTIATING',
        startedAt: this.now(),
        deadlineAt: new Date(Date.parse(this.now()) + seconds * 1000).toISOString(),
      });
    }
    mut.setRun({ status: 'RUNNING', scenarioId: sc.id, startedAt: sc.startedAt, deadlineAt: sc.deadlineAt, lastError: null });
    const msLeft = Math.max(1, Date.parse(sc.deadlineAt ?? this.now()) - Date.now());
    const signals: RunSignals = { abort, deadline: AbortSignal.timeout(msLeft) };
    const warning = setTimeout(() => {
      if (sc.status === 'NEGOTIATING') mut.system(sc, 'DEADLINE_WARNING', `Deadline warning: ${Math.round((msLeft * 0.25) / 1000)} s left for ${sc.id}`);
    }, msLeft * 0.75);
    warning.unref?.();
    try {
      if (sc.round === 0) {
        if (sc.kind === 'EVENT') {
          if (openEventScenario(this.deps, sc) === 'INFEASIBLE_PROVEN') return await this.infeasibilityHearing(sc, signals);
        } else if (buildView(this.s, sc).provenInfeasible) {
          mut.updateScenario(sc, { certificate: certificateFor(sc) });
          return await this.infeasibilityHearing(sc, signals);
        }
      }
      for (let r = sc.round + 1; r <= sc.maxRounds; r++) {
        throwIfAborted(abort);
        if (signals.deadline.aborted) return this.conclude(sc, 'TIMEOUT', `Deadline reached before round ${r}.`);
        const resolved = await this.traced(sc, r, (traceId) => this.round(sc, r, signals, traceId));
        if (resolved) return;
        throwIfAborted(abort);
        if (signals.deadline.aborted) return this.conclude(sc, 'TIMEOUT', `Deadline reached during round ${r}.`);
      }
      await this.deadlock(sc, signals);
    } finally {
      clearTimeout(warning);
    }
  }

  private async traced<T>(sc: Scenario, round: number, fn: (traceId?: string) => Promise<T>): Promise<T> {
    if (this.deps.gateway.mode !== 'live' || this.deps.env.OPENAI_TRACING === 'off') return fn(undefined);
    return withTrace(`ARES · ${sc.title} · Round ${round}`, async (trace) => fn(trace.traceId), {
      groupId: this.s.id,
      metadata: { scenarioId: sc.id, round: String(round) },
    });
  }

  private envelope(turnId: string, res: { source: 'LLM' | 'FALLBACK'; meta: TurnEnvelope['meta'] }): TurnEnvelope {
    return { turnId, source: res.source, meta: res.meta };
  }

  // ── one round ──
  private async round(sc: Scenario, r: number, signals: RunSignals, traceId?: string): Promise<boolean> {
    const { mut } = this.deps;
    mut.updateScenario(sc, { round: r });
    mut.setRun({ round: r });

    await this.briefing(sc, r, signals, traceId);
    throwIfAborted(signals.abort);
    await this.positions(sc, r, signals, traceId);
    throwIfAborted(signals.abort);

    let requestedCheck: ValidationReport | undefined;
    if (r === 1) requestedCheck = this.requestedPlanCheck(sc, r);

    const syn = await this.synthesis(sc, r, signals, traceId, requestedCheck);
    throwIfAborted(signals.abort);
    if (syn.declareInfeasible) {
      const view = buildView(this.s, sc);
      if (view.provenInfeasible) {
        mut.updateScenario(sc, { certificate: certificateFor(sc) });
        await this.declareInfeasible(sc, signals, traceId);
        return true;
      }
      mut.system(sc, 'INFEASIBLE_NOT_PROVEN', `Infeasibility not proven: ${view.effectiveFeasible.length} feasible plan(s) exist`, 'The optimizer found feasible plans; the council continues.');
    }
    if (syn.planVersion === null) return false;
    const plan = this.s.plans.find((p) => p.version === syn.planVersion)!;

    await this.consent(sc, plan, r, signals, traceId);
    throwIfAborted(signals.abort);

    mut.setPhase('VALIDATION');
    const pre = validateAndRecord(this.deps, sc, plan, 'PRE_VOTE');
    if (pre.status === 'FAIL') return false;
    if (r < sc.minRoundsBeforeApproval) {
      mut.system(sc, 'VOTING_DEFERRED', `v${plan.version} passed the validator · voting opens in round ${sc.minRoundsBeforeApproval} (protocol)`);
      return false;
    }

    await this.voting(sc, plan, r, signals, traceId);
    throwIfAborted(signals.abort);
    const t = tally(plan);
    if (!t.unanimous) return false;

    mut.setPhase('VALIDATION');
    const fin = validateAndRecord(this.deps, sc, plan, 'APPROVAL');
    if (fin.status !== 'PASS') return false;
    return this.decision(sc, plan, fin, r, signals, traceId);
  }

  // ── phase 1: briefing ──
  private async briefing(sc: Scenario, r: number, signals: RunSignals, traceId?: string): Promise<void> {
    const { mut } = this.deps;
    mut.setPhase('BRIEFING');
    if (r > 1 && sc.nextBrief) {
      mut.post({
        scenarioId: sc.id,
        round: r,
        phase: 'BRIEFING',
        from: 'COMMANDER',
        type: 'BRIEFING',
        summary: `Round ${r} of ${sc.maxRounds} opens`,
        body: sc.nextBrief.statement,
        planVersion: mut.latestPlanVersion(sc.id),
        data: { round: r, maxRounds: sc.maxRounds, deadlineAt: sc.deadlineAt, asks: sc.nextBrief.asks, pool: sc.pool, policy: sc.policy },
        source: sc.nextBrief.source ?? 'LLM',
      });
      return;
    }
    const view = buildView(this.s, sc);
    const task =
      sc.kind === 'BASELINE'
        ? 'TASK: Publish the crisis to the council (pool, limits, plan version, round limit, deadline) and ask every department for its request. Return the briefing JSON.'
        : 'TASK: Brief the council on the event: what changed (numbers), the status of the previous plan, the commitment review, and whether Crisis Override will be needed (only if no plan fits baseline limits). Ask every department to confirm or revise its package and ask the sacrifice candidates for their stance.';
    const res = await this.call<BriefingOutput>('COMMANDER', 'briefing', commanderPacket({ s: this.s, view, round: r, phase: 'BRIEFING', now: this.now(), task }), sc, r, signals, traceId, () =>
      fallbackBriefing(this.s, view, r),
    );
    const turnId = mut.nextTurnId();
    this.remember('COMMANDER', sc, r, res.output.privateNote);
    mut.post({
      scenarioId: sc.id,
      round: r,
      phase: 'BRIEFING',
      from: 'COMMANDER',
      type: 'BRIEFING',
      summary: r === 1 ? `${sc.kind === 'BASELINE' ? 'Crisis briefing' : `Event briefing: ${sc.title}`} · pool ${Object.values(sc.pool).join('/')} · ${sc.maxRounds} rounds max` : `Round ${r} opens`,
      body: res.output.statement,
      planVersion: mut.latestPlanVersion(sc.id) ?? this.s.planInForceVersion,
      data: { round: r, maxRounds: sc.maxRounds, deadlineAt: sc.deadlineAt, asks: res.output.asks, pool: sc.pool, policy: sc.policy },
      turnId,
      source: res.source,
      meta: res.meta,
    });
  }

  // ── phase 2: positions (four departments in parallel) ──
  private async positions(sc: Scenario, r: number, signals: RunSignals, traceId?: string, task?: string): Promise<void> {
    const { mut } = this.deps;
    mut.setPhase('POSITIONS');
    const view = buildView(this.s, sc);
    const seenSeq = this.s.counters.seq;
    const packets = Object.fromEntries(
      DEPARTMENT_IDS.map((d) => [d, departmentPacket({ s: this.s, view, dept: d, round: r, phase: 'POSITIONS', now: this.now(), task })]),
    ) as Record<DepartmentId, string>;
    await Promise.all(
      DEPARTMENT_IDS.map(async (dept) => {
        const res = await this.call<DepartmentTurnOutput>(dept, 'turn', packets[dept], sc, r, signals, traceId, () => fallbackDepartmentTurn(this.s, view, dept, r));
        applyDepartmentTurn(this.deps, sc, view, dept, res.output, this.envelope(mut.nextTurnId(), res), seenSeq);
      }),
    );
  }

  /** Round 1: assemble the requested packages into a plan version and validate it (PDF step 3, find conflicts). */
  private requestedPlanCheck(sc: Scenario, r: number): ValidationReport {
    const selections = Object.fromEntries(
      DEPARTMENT_IDS.map((d) => [d, this.s.agents[d].requestedMode ?? restrictedModeOf(d)]),
    ) as Plan['selections'];
    const proposals = this.s.messages.filter((m) => m.scenarioId === sc.id && m.round === r && m.type === 'PROPOSAL').map((m) => m.id);
    const { plan } = createOrReusePlan(this.deps, sc, r, selections, {
      label: 'Requested packages',
      rationale: `Assembled by the Commander from the Round ${r} requests for a conflict check.`,
      respondsTo: proposals,
    });
    this.deps.mut.setPhase('VALIDATION');
    return validateAndRecord(this.deps, sc, plan, 'PRE_VOTE');
  }

  // ── phase 3: synthesis ──
  private async synthesis(sc: Scenario, r: number, signals: RunSignals, traceId: string | undefined, requestedCheck?: ValidationReport): Promise<{ planVersion: number | null; declareInfeasible: boolean }> {
    const { mut } = this.deps;
    mut.setPhase('SYNTHESIS');
    const view = buildView(this.s, sc);
    const mustDraft = !(sc.kind === 'BASELINE' && r === 1);
    const task = [
      `TASK (round ${r} of max ${sc.maxRounds}): synthesize the council.`,
      '1) Name the conflicts with exact numbers (the optimizer and validator facts above are authoritative).',
      mustDraft
        ? '2) You MUST draft a plan this round (DRAFT_PLAN) if any feasible plan exists: choose from the feasible set and justify the sacrifice (colony safety, fairness, reserve margins). List the return commitment ids for every sacrificing department and add Commander commitments where fair.'
        : '2) Round 1: requests usually exceed the pool. Prefer REQUEST_CHANGES: ask for concessions, name the sacrifice candidates from the optimizer, ask them for their stance and invite compensation offers.',
      view.feasibleCurrent.length === 0 && view.overrideWouldBeAllowed
        ? '3) No plan fits baseline limits after this event: set invokeCrisisOverride=true with a justification, then draft from the Crisis Override list.'
        : '3) Do not invoke Crisis Override unless no plan fits baseline limits after an event.',
      '4) Only if the optimizer proves no plan exists under any available policy: DECLARE_INFEASIBLE.',
      '5) Write nextRoundBrief and directives (asks) for the next round.',
    ].join('\n');
    const res = await this.call<SynthesisOutput>(
      'COMMANDER',
      'synthesis',
      commanderPacket({ s: this.s, view, round: r, phase: 'SYNTHESIS', now: this.now(), task, requestedCheck }),
      sc,
      r,
      signals,
      traceId,
      () => fallbackSynthesis(this.s, view, r, requestedCheck),
      synthesisIssues,
    );
    const out = res.output;
    const env = this.envelope(mut.nextTurnId(), res);
    this.remember('COMMANDER', sc, r, out.privateNote);
    mut.updateAgent('COMMANDER', (a) => {
      a.lastSeenSeq = this.s.counters.seq;
    });

    // Conflict report (PDF step 3)
    if (out.action !== 'DRAFT_PLAN' && (out.conflicts.length || out.analysis)) {
      mut.post({
        scenarioId: sc.id,
        round: r,
        phase: 'SYNTHESIS',
        from: 'COMMANDER',
        type: 'OBJECTION',
        subtype: 'CONFLICT_REPORT',
        summary: `Conflict report: ${out.conflicts.slice(0, 2).join(' · ').slice(0, 200) || out.analysis.slice(0, 160)}`,
        body: [out.analysis, ...out.responsesToObjections.map((x) => `↳ ${x.messageId}: ${x.response}`)].join('\n'),
        planVersion: mut.latestPlanVersion(sc.id),
        data: { kind: 'CONFLICT_REPORT', conflicts: out.conflicts, responses: out.responsesToObjections },
        turnId: env.turnId,
        source: env.source,
        meta: env.meta,
      });
    }

    // Crisis Override (engine-gated)
    const draftNeedsOverride =
      out.action === 'DRAFT_PLAN' && out.plan
        ? selectionTotals({ LIFE_SUPPORT: out.plan.LIFE_SUPPORT, MEDICAL: out.plan.MEDICAL, FOOD: out.plan.FOOD, ENGINEERING: out.plan.ENGINEERING }).sacrifices.length > sc.policy.maxSacrifices
        : false;
    if (out.invokeCrisisOverride || (draftNeedsOverride && view.overrideWouldBeAllowed)) {
      const gate = canInvokeOverride(sc, view.feasibleCurrent.length);
      if (gate.allowed && (view.feasibleOverride?.length ?? 0) > 0) {
        mut.updateScenario(sc, { policy: overridePolicy() });
        mut.post({
          scenarioId: sc.id,
          round: r,
          phase: 'SYNTHESIS',
          from: 'COMMANDER',
          type: 'SYSTEM',
          subtype: 'OVERRIDE_INVOKED',
          summary: 'CRISIS OVERRIDE invoked: risk limit 24 → 28, up to 2 Sacrifice modes',
          body: out.overrideJustification || (draftNeedsOverride ? 'The drafted plan needs a second Sacrifice; no plan fits baseline limits.' : gate.reason),
          planVersion: mut.latestPlanVersion(sc.id),
          data: { justification: out.overrideJustification, feasibleUnderBase: view.feasibleCurrent.length, feasibleUnderOverride: view.feasibleOverride?.length ?? 0 },
          turnId: env.turnId,
          source: env.source,
          meta: env.meta,
        });
      } else if (out.invokeCrisisOverride) {
        mut.system(sc, 'OVERRIDE_DENIED', gate.allowed ? 'Crisis Override denied: it would not make any plan feasible' : gate.reason);
      }
    }

    // Commander's own return commitments
    for (const cc of out.commanderCommitments.slice(0, 4)) registerOffer(this.deps, sc, 'COMMANDER', cc as OfferInput, env);

    mut.updateScenario(sc, { nextBrief: { statement: out.nextRoundBrief, asks: out.directives, source: res.source } });

    if (out.action === 'DECLARE_INFEASIBLE') return { planVersion: null, declareInfeasible: true };
    if (out.action !== 'DRAFT_PLAN' || !out.plan) return { planVersion: null, declareInfeasible: false };
    const { label, includeCommitmentIds, rationale, ...selections } = out.plan;
    const recentObjections = this.s.messages.filter((m) => m.scenarioId === sc.id && m.round === r && m.type === 'OBJECTION' && m.from !== 'COMMANDER').map((m) => m.id);
    const { plan } = createOrReusePlan(this.deps, sc, r, selections, {
      label: label.slice(0, 80) || 'Commander draft',
      rationale: `${rationale}${out.analysis ? ` — ${out.analysis}` : ''}`.slice(0, 1200),
      respondsTo: [...new Set([...out.responsesToObjections.map((x) => x.messageId), ...recentObjections])].slice(0, 12),
      includeIds: includeCommitmentIds,
      turnId: env.turnId,
      source: env.source,
    });
    return { planVersion: plan.version, declareInfeasible: false };
  }

  // ── phase 4: consent (designated sacrificing departments) ──
  private async consent(sc: Scenario, plan: Plan, r: number, signals: RunSignals, traceId?: string): Promise<void> {
    const { mut } = this.deps;
    const required = sc.policy.requiredReturnCommitments;
    const todo = plan.sacrifices.filter((dept) => {
      const included = this.s.commitments.filter((c) => plan.commitmentIds.includes(c.id) && c.beneficiary === dept);
      if (included.length === 0) return false;
      const pending = included.filter((c) => c.status === 'OFFERED');
      const accepted = included.filter((c) => c.status === 'ACCEPTED' || c.status === 'ACTIVE');
      return pending.length > 0 || distinctOwners(accepted) < required;
    });
    if (todo.length === 0) return;
    mut.setPhase('CONSENT');
    const view = buildView(this.s, sc);
    const seenSeq = this.s.counters.seq;
    await Promise.all(
      todo.map(async (dept) => {
        const included = this.s.commitments.filter((c) => plan.commitmentIds.includes(c.id) && c.beneficiary === dept);
        const task = [
          `CONSENT — You are designated to run ${plan.selections[dept]} in plan v${plan.version} ("${plan.label}").`,
          'Return commitments offered to you in this plan:',
          ...included.map((c) => `  ${commitmentLine(c)}`),
          `Accept or decline each OFFERED one by id, and state your stance. ACCEPT the sacrifice only if you hold at least ${required} acceptable returns from different agents.`,
        ].join('\n');
        const packet = departmentPacket({ s: this.s, view, dept, round: r, phase: 'CONSENT', now: this.now(), task });
        const res = await this.call<ConsentOutput>(dept, 'consent', packet, sc, r, signals, traceId, () => fallbackConsent(this.s, plan, dept, required));
        applyConsent(this.deps, sc, plan, dept, res.output, this.envelope(mut.nextTurnId(), res), seenSeq);
      }),
    );
  }

  // ── phase 6: voting (four departments in parallel, bound to version + hash) ──
  private async voting(sc: Scenario, plan: Plan, r: number, signals: RunSignals, traceId?: string): Promise<void> {
    const { mut } = this.deps;
    mut.setPhase('VOTING');
    mut.setPlanStatus(plan, 'VOTING');
    const view = buildView(this.s, sc);
    const required = sc.policy.requiredReturnCommitments;
    const seenSeq = this.s.counters.seq;
    const report = plan.validations[plan.validations.length - 1];
    await Promise.all(
      DEPARTMENT_IDS.map(async (dept) => {
        const task = [
          `BALLOT — Vote ACCEPT or REJECT on plan v${plan.version} (hash ${plan.hash.slice(0, 8)}): ${planLine(plan, sc)}`,
          `Validator: ${reportLine(report)}`,
          `ACCEPT only if the validator passed it and it is fair to ${PROFILES[dept].departmentName}.${plan.sacrifices.includes(dept) ? ` You are the sacrificing department: ACCEPT only if you hold at least ${required} accepted returns from different agents.` : ''}`,
          `planVersion must equal ${plan.version}.`,
        ].join('\n');
        const packet = departmentPacket({ s: this.s, view, dept, round: r, phase: 'VOTING', now: this.now(), task });
        const res = await this.call<BallotOutput>(dept, 'ballot', packet, sc, r, signals, traceId, () => fallbackBallot(this.s, plan, dept, required), (o) => ballotIssues(o, plan.version), plan.version);
        const out = res.output;
        const env = this.envelope(mut.nextTurnId(), res);
        mut.updateAgent(dept, (a) => {
          if (out.privateNote.trim()) a.memory.push({ scenarioId: sc.id, round: r, note: out.privateNote.slice(0, 400), at: this.now() });
          a.lastSeenSeq = Math.max(a.lastSeenSeq, seenSeq);
        });
        if (out.planVersion !== plan.version) {
          mut.system(sc, 'INVALID_BALLOT', `${PROFILES[dept].callsign} voted on v${out.planVersion} instead of v${plan.version}: ballot not counted`);
          return;
        }
        const vote: Vote = {
          id: mut.nextVoteId(),
          agentId: dept,
          planVersion: plan.version,
          planHash: plan.hash,
          decision: out.decision,
          reason: out.reason.slice(0, 600),
          conditionsForAccept: out.conditionsForAccept.slice(0, 4),
          round: r,
          source: res.source,
          createdAt: this.now(),
        };
        mut.addVote(plan, vote);
        mut.post({
          scenarioId: sc.id,
          round: r,
          phase: 'VOTING',
          from: dept,
          type: 'VOTE',
          subtype: vote.decision,
          summary: `${vote.decision} v${plan.version} (#${plan.hash.slice(0, 8)})`,
          body: vote.reason,
          planVersion: plan.version,
          data: {
            vote,
            outputSchemaRecord: toOutputSchemaRecord({
              round: r,
              dept,
              modeId: plan.selections[dept],
              justification: vote.reason,
              vote: vote.decision,
              planVersion: plan.version,
              planTotalRisk: plan.risk,
              hitlThreshold: this.s.config.hitl.riskThreshold,
            }),
          },
          turnId: env.turnId,
          source: env.source,
          meta: env.meta,
        });
      }),
    );
    const t = tally(plan);
    if (t.reject > 0) {
      const reasons = Object.values(t.byAgent)
        .filter((v) => v?.decision === 'REJECT')
        .map((v) => `${v!.agentId}: ${v!.reason}`);
      mut.setPlanStatus(plan, 'REJECTED', reasons.join(' | ').slice(0, 500));
    }
  }

  // ── phase 7: decision (approval gate in code) ──
  private async decision(sc: Scenario, plan: Plan, fin: ValidationReport, r: number, signals: RunSignals, traceId?: string): Promise<boolean> {
    const { mut } = this.deps;
    mut.setPhase('DECISION');
    const view = buildView(this.s, sc);
    const task = `DECISION — The validator returned PASS at the APPROVAL stage and all four departments voted ACCEPT on v${plan.version}. Approve it (decision APPROVE) with a statement citing the version, the final validation result and the votes. Choose CONTINUE only for a concrete, numeric safety reason.`;
    const res = await this.call<DecisionOutput>('COMMANDER', 'decision', commanderPacket({ s: this.s, view, round: r, phase: 'DECISION', now: this.now(), task }), sc, r, signals, traceId, () =>
      fallbackDecision('APPROVE', plan, fin),
    );
    this.remember('COMMANDER', sc, r, res.output.privateNote);
    if (res.output.decision !== 'APPROVE') {
      mut.post({
        scenarioId: sc.id,
        round: r,
        phase: 'DECISION',
        from: 'COMMANDER',
        type: 'BRIEFING',
        subtype: 'CONTINUE',
        summary: `Commander continues instead of approving v${plan.version}`,
        body: res.output.statement,
        planVersion: plan.version,
        source: res.source,
        meta: res.meta,
      });
      return false;
    }
    return this.approve(sc, plan, res.output.statement, this.envelope(mut.nextTurnId(), res));
  }

  /** The approval gate: re-validates itself. There is no code path to APPROVED without a fresh PASS and 4/4 ACCEPT. */
  approve(sc: Scenario, plan: Plan, statement: string, env: TurnEnvelope): boolean {
    const { mut } = this.deps;
    const report = validateAndRecord(this.deps, sc, plan, 'APPROVAL', true);
    if (report.status !== 'PASS' || !tally(plan).unanimous) {
      mut.system(sc, 'APPROVAL_BLOCKED', `Approval of v${plan.version} BLOCKED: ${failedChecks(report).map((c) => c.id).join(', ') || 'votes not unanimous'}`, failedChecks(report).map((c) => `${c.id}: ${c.reason}`).join('\n'), { report });
      return false;
    }
    const now = this.now();
    mut.setPlanStatus(plan, 'APPROVED');
    for (const c of this.s.commitments.filter((x) => plan.commitmentIds.includes(x.id) && x.status === 'ACCEPTED')) {
      mut.setCommitmentStatus(c, 'ACTIVE', 'COMMANDER', `Part of approved plan v${plan.version}`);
    }
    for (const dept of plan.sacrifices) {
      mut.updateAgent(dept, (a) => {
        a.sacrificeLedger.push({ scenarioId: sc.id, modeId: plan.selections[dept], planVersion: plan.version, commitmentIds: plan.commitmentIds.filter((id) => this.s.commitments.find((c) => c.id === id)?.beneficiary === dept) });
      });
    }
    mut.setPlanInForce(plan.version);
    const hitl = this.s.config.hitl.enabled && plan.risk > this.s.config.hitl.riskThreshold;
    mut.updateScenario(sc, {
      status: hitl ? 'AWAITING_COUNTERSIGN' : 'RESOLVED',
      outcome: 'APPROVED',
      outcomeReason: hitl ? 'Approved by the council; awaiting human countersign' : `Approved v${plan.version}`,
      approvedPlanVersion: plan.version,
      resolvedAt: now,
    });
    const latest = tally(plan);
    mut.post({
      scenarioId: sc.id,
      round: sc.round,
      phase: 'DECISION',
      from: 'COMMANDER',
      type: 'APPROVAL',
      summary: `Plan v${plan.version} APPROVED · validator PASS · 4/4 ACCEPT · risk ${plan.risk}`,
      body: statement,
      planVersion: plan.version,
      data: { version: plan.version, hash: plan.hash, finalValidation: report, votes: Object.values(latest.byAgent) },
      turnId: env.turnId,
      source: env.source,
      meta: env.meta,
    });
    if (hitl) {
      mut.system(sc, 'HITL_REQUIRED', `Human countersign required: plan v${plan.version} risk ${plan.risk} > ${this.s.config.hitl.riskThreshold}`);
      mut.setRun({ status: 'AWAITING_COUNTERSIGN', phase: 'DONE' });
    } else {
      mut.setRun({ status: 'COMPLETED', phase: 'DONE' });
    }
    mut.toast('success', `${sc.id}: plan v${plan.version} approved in round ${sc.round}`);
    return true;
  }

  // ── outcomes ──
  conclude(sc: Scenario, outcome: Exclude<ScenarioOutcome, 'APPROVED'>, detail: string, statement?: string, extra: Record<string, unknown> = {}): void {
    const { mut } = this.deps;
    const plans = this.s.plans.filter((p) => p.scenarioId === sc.id);
    const last = plans[plans.length - 1];
    const blocking: string[] = [];
    if (last) {
      const report = last.validations[last.validations.length - 1];
      if (report) blocking.push(...failedChecks(report).map((c) => `${c.id}: ${c.reason}`));
      for (const v of Object.values(tally(last).byAgent)) if (v?.decision === 'REJECT') blocking.push(`${v.agentId} REJECT: ${v.reason}`);
    }
    mut.updateScenario(sc, { status: 'RESOLVED', outcome, outcomeReason: detail, resolvedAt: this.now() });
    const resolution =
      outcome === 'INFEASIBLE'
        ? (sc.certificate?.requests[0] ?? 'Request external supply')
        : outcome === 'INTERRUPTED'
          ? 'Resume the negotiation or inject the next event.'
          : 'Resume for two more rounds, adjust resources, or accept the closest validated plan.';
    mut.post({
      scenarioId: sc.id,
      round: sc.round,
      phase: 'DECISION',
      from: outcome === 'INTERRUPTED' || outcome === 'TIMEOUT' ? 'SYSTEM' : 'COMMANDER',
      type: 'DECISION',
      subtype: outcome,
      summary: `${outcome}: ${detail}`.slice(0, 300),
      body: statement ?? detail,
      planVersion: last?.version ?? null,
      data: { outcome, certificate: sc.certificate, lastPlanVersion: last?.version ?? null, blockingReasons: blocking, resolution, ...extra },
      source: extra.source === 'LLM' ? 'LLM' : extra.source === 'FALLBACK' ? 'FALLBACK' : 'DETERMINISTIC',
      meta: (extra.meta as never) ?? null,
    });
    mut.setRun({ status: 'COMPLETED', phase: 'DONE' });
    mut.toast(outcome === 'INTERRUPTED' ? 'info' : 'warning', `${sc.id}: ${outcome}`);
  }

  private async deadlock(sc: Scenario, signals: RunSignals): Promise<void> {
    const view = buildView(this.s, sc);
    const plans = this.s.plans.filter((p) => p.scenarioId === sc.id);
    const last = plans[plans.length - 1] ?? null;
    const res = await this.call<DecisionOutput>(
      'COMMANDER',
      'decision',
      commanderPacket({ s: this.s, view, round: sc.round, phase: 'DECISION', now: this.now(), task: 'DECISION — The round limit is reached without an approval. Declare DEADLOCK: summarize the blocking reasons (validator failures, REJECT votes) and the resolution you recommend.' }),
      sc,
      sc.round,
      signals,
      undefined,
      () => fallbackDecision('DEADLOCK', last, null, `Round limit ${sc.maxRounds} reached.`),
    );
    this.conclude(sc, 'DEADLOCK', `Round limit ${sc.maxRounds} reached without four ACCEPT votes on a validated plan.`, res.output.statement, { source: res.source, meta: res.meta });
  }

  private async declareInfeasible(sc: Scenario, signals: RunSignals, traceId?: string): Promise<void> {
    const view = buildView(this.s, sc);
    const cert = sc.certificate ?? certificateFor(sc);
    const res = await this.call<DecisionOutput>(
      'COMMANDER',
      'decision',
      commanderPacket({ s: this.s, view, round: sc.round, phase: 'DECISION', now: this.now(), task: 'DECISION — Declare INFEASIBLE using the certificate: the blocking constraints and the exact extra resource or policy change needed.' }),
      sc,
      sc.round,
      signals,
      traceId,
      () => fallbackDecision('INFEASIBLE', null, null, `${cert.blocking.map((b) => b.detail).join(' ')} ${cert.requests.join(' ')}`),
    );
    this.conclude(sc, 'INFEASIBLE', cert.blocking[0]?.detail ?? 'No feasible plan', res.output.statement, { source: res.source, meta: res.meta });
  }

  /** One visible round when infeasibility is proven immediately: briefing → departments state minimum needs → INFEASIBLE. */
  private async infeasibilityHearing(sc: Scenario, signals: RunSignals): Promise<void> {
    const { mut } = this.deps;
    await this.traced(sc, 1, async (traceId) => {
      mut.updateScenario(sc, { round: 1 });
      mut.setRun({ round: 1 });
      await this.briefing(sc, 1, signals, traceId);
      throwIfAborted(signals.abort);
      await this.positions(sc, 1, signals, traceId, 'TASK: The optimizer PROVED that no plan fits. State your minimum viable package and the exact external supply your department would need (JSON schema enforced).');
      throwIfAborted(signals.abort);
      await this.declareInfeasible(sc, signals, traceId);
    });
  }

  // ── helpers ──
  private remember(agentId: 'COMMANDER' | DepartmentId, sc: Scenario, round: number, note: string): void {
    if (!note.trim()) return;
    this.deps.mut.updateAgent(agentId, (a) => {
      a.memory.push({ scenarioId: sc.id, round, note: note.slice(0, 400), at: this.now() });
    });
  }

  private async call<T>(
    agentId: 'COMMANDER' | DepartmentId,
    kind: 'turn' | 'ballot' | 'consent' | 'briefing' | 'synthesis' | 'decision',
    packet: string,
    sc: Scenario,
    round: number,
    signals: RunSignals,
    traceId: string | undefined,
    fallback: () => T,
    validate?: (out: T) => string[],
    expectVersion?: number,
  ) {
    const { mut, gateway } = this.deps;
    mut.setAgentStatus(agentId, 'THINKING');
    try {
      return await gateway.run<T>({
        agentId,
        kind,
        packet,
        context: agentContext(this.deps, agentId, sc.id, round, { planVersion: expectVersion }),
        validate,
        fallback,
        abortSignal: signals.abort,
        deadlineSignal: signals.deadline,
        traceId,
      });
    } catch (err) {
      if (!signals.abort.aborted) log.error(`${agentId}/${kind} failed unexpectedly`, err);
      throw err;
    } finally {
      mut.setAgentStatus(agentId, 'DONE');
    }
  }
}

