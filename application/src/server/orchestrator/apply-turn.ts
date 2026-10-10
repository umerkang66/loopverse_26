import 'server-only';
import { PROFILES, getMode, lossOf, modesFor } from '@/domain/scenario';
import type {
  AgentId,
  Commitment,
  CommitmentKind,
  DepartmentId,
  Expiry,
  LlmMeta,
  MessageSource,
  ModeId,
  Plan,
  ResourceKey,
  Scenario,
} from '@/domain/types';
import { sacrificeModeOf, selectionKey } from '@/engine/catalog';
import { constraintsOf } from '@/engine/policy';
import { capOf, fmt, fmtVs } from '@/engine/resources';
import { failedChecks, validatePlan } from '@/engine/validator';
import { toOutputSchemaRecord } from '../export/output-schema';
import type { ConsentOutput, DepartmentTurnOutput } from '../agents/schemas';
import type { RunnerDeps } from './deps';
import { includedCommitments } from './plan-ops';
import type { ScenarioView } from './view';

const KIND_LABEL: Record<string, string> = {
  RESOURCE_CONFLICT: 'Resource conflict',
  UNFAIR_SACRIFICE: 'Unfair sacrifice',
  SACRIFICE_REFUSAL: 'Sacrifice refused',
  RISK_LIMIT: 'Risk limit',
  MISSING_RETURN: 'Missing return',
  INVALID_PLAN: 'Invalid plan',
  OTHER: 'Objection',
  CONFLICT_REPORT: 'Conflict report',
};

const callsign = (id: string) => (id in PROFILES ? PROFILES[id as AgentId].callsign : id);

export interface TurnEnvelope {
  turnId: string;
  source: MessageSource;
  meta: LlmMeta;
}

export interface OfferInput {
  beneficiary: DepartmentId;
  kind: CommitmentKind;
  resource: ResourceKey | null;
  amount: number | null;
  promise: string;
  expiry: Expiry;
  onlyIfSacrificeMode: ModeId | null;
}

/** Validate and register one commitment offer; returns null (and explains why) if it cannot stand. */
export function registerOffer(deps: RunnerDeps, scenario: Scenario, owner: AgentId, offer: OfferInput, env: TurnEnvelope): Commitment | null {
  const s = deps.state();
  const reject = (why: string) => {
    deps.mut.system(scenario, 'OFFER_REJECTED', `${callsign(owner)}'s offer to ${callsign(offer.beneficiary)} was not registered: ${why}`, `"${offer.promise}" — ${why}`);
    return null;
  };
  if (owner === offer.beneficiary) return reject('a department cannot compensate itself');
  if ((offer.kind === 'RESOURCE_SHARE' || offer.kind === 'RESERVE_ASSIGNMENT') && (!offer.resource || !offer.amount || offer.amount <= 0)) {
    return reject('a resource commitment needs a resource and a positive amount');
  }
  if (offer.kind === 'RESERVE_ASSIGNMENT' && owner !== 'COMMANDER') return reject('only the Commander can assign the colony reserve');
  if (offer.kind === 'RESOURCE_SHARE' && owner === 'COMMANDER') return reject('the Commander has no package to share');
  if (offer.kind === 'RESOURCE_SHARE' && owner !== 'COMMANDER' && offer.resource && offer.amount) {
    const max = Math.max(...modesFor(owner as DepartmentId).map((m) => m.resources[offer.resource!]));
    if (offer.amount > max) return reject(`no ${owner} package holds ${offer.amount} ${offer.resource}`);
  }
  if (offer.onlyIfSacrificeMode && getMode(offer.onlyIfSacrificeMode).department !== offer.beneficiary) {
    offer = { ...offer, onlyIfSacrificeMode: sacrificeModeOf(offer.beneficiary) };
  }
  const duplicate = s.commitments.find(
    (c) => c.owner === owner && c.beneficiary === offer.beneficiary && c.promise.trim().toLowerCase() === offer.promise.trim().toLowerCase() && ['OFFERED', 'ACCEPTED', 'ACTIVE'].includes(c.status),
  );
  if (duplicate) return duplicate;
  const expiry: Expiry = { ...offer.expiry, value: Math.max(1, Math.round(offer.expiry.value)) };
  const commitment: Commitment = {
    id: deps.mut.nextCommitmentId(),
    scenarioId: scenario.id,
    round: scenario.round,
    createdAtHour: scenario.colonyHour,
    owner,
    beneficiary: offer.beneficiary,
    kind: offer.kind,
    resource: offer.resource,
    amount: offer.amount,
    promise: offer.promise.slice(0, 280),
    expiry,
    onlyIfSacrificeMode: offer.onlyIfSacrificeMode,
    status: 'OFFERED',
    history: [{ at: deps.now(), status: 'OFFERED', by: owner, reason: 'offered' }],
    sourceMessageId: null,
  };
  deps.mut.addCommitment(commitment);
  const msg = deps.mut.post({
    scenarioId: scenario.id,
    round: scenario.round,
    phase: deps.state().run.phase,
    from: owner,
    type: 'COMMITMENT',
    subtype: 'OFFER',
    summary: `${commitment.id} ${callsign(owner)} → ${callsign(offer.beneficiary)}: ${commitment.promise} (${expiry.label}${commitment.onlyIfSacrificeMode ? `, if ${commitment.onlyIfSacrificeMode}` : ''})`,
    body: commitment.promise,
    data: { commitmentId: commitment.id, action: 'OFFER', commitment },
    turnId: env.turnId,
    source: env.source,
    meta: env.meta,
  });
  commitment.sourceMessageId = msg.id;
  return commitment;
}

export function respondToOffer(deps: RunnerDeps, scenario: Scenario, dept: DepartmentId, commitmentId: string, decision: 'ACCEPT' | 'DECLINE', reason: string, env: TurnEnvelope): void {
  const c = deps.state().commitments.find((x) => x.id === commitmentId);
  if (!c || c.beneficiary !== dept || c.status !== 'OFFERED') return;
  deps.mut.setCommitmentStatus(c, decision === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED', dept, reason);
  deps.mut.post({
    scenarioId: scenario.id,
    round: scenario.round,
    phase: deps.state().run.phase,
    from: dept,
    type: 'COMMITMENT',
    subtype: decision,
    summary: `${c.id} ${decision === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED'} by ${callsign(dept)}: ${c.promise}`,
    body: reason,
    data: { commitmentId: c.id, action: decision, commitment: c },
    turnId: env.turnId,
    source: env.source,
    meta: env.meta,
  });
}

export function postRefusal(deps: RunnerDeps, scenario: Scenario, dept: DepartmentId, conditions: string[], env: TurnEnvelope, detail?: string): void {
  const sac = sacrificeModeOf(dept);
  deps.mut.post({
    scenarioId: scenario.id,
    round: scenario.round,
    phase: deps.state().run.phase,
    from: dept,
    type: 'OBJECTION',
    subtype: 'SACRIFICE_REFUSAL',
    summary: `${KIND_LABEL.SACRIFICE_REFUSAL}: ${callsign(dept)} refuses ${sac}`,
    body: detail ?? `${callsign(dept)} refuses ${sac}${lossOf(sac) ? ` (${lossOf(sac)})` : ''}.${conditions.length ? ` Conditions: ${conditions.join('; ')}.` : ''}`,
    data: { kind: 'SACRIFICE_REFUSAL', target: 'COMMANDER', modeId: sac, conditions },
    turnId: env.turnId,
    source: env.source,
    meta: env.meta,
  });
}

/** Apply one department turn: record state, then PROPOSAL, OBJECTION(s), COUNTEROFFER, COMMITMENT offers/responses. */
export function applyDepartmentTurn(
  deps: RunnerDeps,
  scenario: Scenario,
  view: ScenarioView,
  dept: DepartmentId,
  output: DepartmentTurnOutput,
  env: TurnEnvelope,
  seenSeq: number,
): void {
  const s = deps.state();
  const round = scenario.round;
  const mode = getMode(output.requestedMode as ModeId);
  deps.mut.updateAgent(dept, (a) => {
    a.requestedMode = mode.id;
    a.requestHistory.push({ scenarioId: scenario.id, round, modeId: mode.id });
    a.stance = { sacrifice: output.sacrificeStance, conditions: output.sacrificeConditions.slice(0, 4), round, scenarioId: scenario.id };
    a.stanceHistory.push({ scenarioId: scenario.id, round, stance: output.sacrificeStance });
    if (output.privateNote.trim()) a.memory.push({ scenarioId: scenario.id, round, note: output.privateNote.slice(0, 400), at: deps.now() });
    a.lastSeenSeq = Math.max(a.lastSeenSeq, seenSeq);
  });
  const common = { scenarioId: scenario.id, round, phase: s.run.phase, from: dept, turnId: env.turnId, source: env.source, meta: env.meta } as const;
  const latest = view.latestPlan;
  deps.mut.post({
    ...common,
    type: 'PROPOSAL',
    summary: `Requests ${mode.id} ${mode.label} (${fmt(mode.resources)} · risk ${mode.risk})${output.sacrificeStance !== 'NOT_ASKED' ? ` · stance ${output.sacrificeStance}` : ''}`,
    body: output.publicStatement,
    planVersion: latest?.version ?? null,
    data: {
      modeId: mode.id,
      tier: mode.tier,
      package: { resources: mode.resources, risk: mode.risk },
      consequence: output.consequence,
      reason: output.reason,
      stance: output.sacrificeStance,
      conditions: output.sacrificeConditions,
      outputSchemaRecord: toOutputSchemaRecord({
        round,
        dept,
        modeId: mode.id,
        justification: output.reason,
        vote: null,
        planVersion: latest?.version ?? null,
        planTotalRisk: latest?.risk ?? null,
        hitlThreshold: s.config.hitl.riskThreshold,
      }),
    },
  });

  const objections = output.objections.slice(0, 3);
  for (const o of objections) {
    const target = o.target === 'PLAN' ? 'ALL' : ([o.target] as AgentId[]);
    deps.mut.post({
      ...common,
      to: target,
      type: 'OBJECTION',
      subtype: o.kind,
      summary: `${KIND_LABEL[o.kind] ?? 'Objection'}: ${o.detail.slice(0, 140)}`,
      body: o.detail,
      planVersion: latest?.version ?? null,
      data: { kind: o.kind, target: o.target, detail: o.detail },
    });
  }
  const designated = latest?.selections[dept] === sacrificeModeOf(dept);
  const refusedBefore = s.messages.some((m) => m.scenarioId === scenario.id && m.from === dept && m.subtype === 'SACRIFICE_REFUSAL');
  if (
    output.sacrificeStance === 'REFUSE' &&
    (designated || (view.candidates.includes(dept) && !refusedBefore)) &&
    !objections.some((o) => o.kind === 'SACRIFICE_REFUSAL')
  ) {
    postRefusal(deps, scenario, dept, output.sacrificeConditions, env);
  }

  if (output.counteroffer) {
    const { compensationTerms, rationale, ...selections } = output.counteroffer;
    const dryRun = validatePlan({
      selections,
      claimedTotals: output.claimedTotals ? { agentId: dept, totals: output.claimedTotals } : null,
      scenario: { ...constraintsOf(scenario), policy: scenario.policy, colonyHour: scenario.colonyHour, index: scenario.index },
      includedCommitments: includedCommitments(deps, selections),
      stage: 'DRY_RUN',
      now: deps.now(),
    });
    const cap = capOf(scenario.pool, scenario.reserveRequirements);
    deps.mut.post({
      ...common,
      type: 'COUNTEROFFER',
      summary: `${selectionKey(selections)} → ${fmtVs(dryRun.totals, cap)} · risk ${dryRun.risk} · dry-run ${dryRun.status}${dryRun.status === 'FAIL' ? ` (${failedChecks(dryRun).map((c) => c.id).join(', ')})` : ''}`,
      body: `${rationale} Compensation: ${compensationTerms}`,
      planVersion: latest?.version ?? null,
      data: { selections, compensationTerms, rationale, dryRun, claimedTotals: output.claimedTotals },
    });
  }

  for (const offer of output.commitmentOffers.slice(0, 2)) {
    registerOffer(deps, scenario, dept, offer as OfferInput, env);
  }
  for (const response of output.commitmentResponses) {
    respondToOffer(deps, scenario, dept, response.commitmentId, response.decision, response.reason, env);
  }
}

/** Apply a consent micro-turn of a designated sacrificing department. */
export function applyConsent(deps: RunnerDeps, scenario: Scenario, plan: Plan, dept: DepartmentId, output: ConsentOutput, env: TurnEnvelope, seenSeq: number): void {
  const round = scenario.round;
  deps.mut.updateAgent(dept, (a) => {
    a.stance = { sacrifice: output.sacrificeStance, conditions: output.additionalReturnNeeded ? [output.additionalReturnNeeded] : [], round, scenarioId: scenario.id };
    a.stanceHistory.push({ scenarioId: scenario.id, round, stance: output.sacrificeStance });
    if (output.privateNote.trim()) a.memory.push({ scenarioId: scenario.id, round, note: output.privateNote.slice(0, 400), at: deps.now() });
    a.lastSeenSeq = Math.max(a.lastSeenSeq, seenSeq);
  });
  deps.mut.post({
    scenarioId: scenario.id,
    round,
    phase: 'CONSENT',
    from: dept,
    type: 'COMMITMENT',
    subtype: 'CONSENT',
    summary: `${callsign(dept)} on ${plan.selections[dept]} in v${plan.version}: ${output.sacrificeStance}`,
    body: output.statement,
    planVersion: plan.version,
    data: { stance: output.sacrificeStance, additionalReturnNeeded: output.additionalReturnNeeded },
    turnId: env.turnId,
    source: env.source,
    meta: env.meta,
  });
  for (const r of output.responses) {
    if (!plan.commitmentIds.includes(r.commitmentId)) continue;
    respondToOffer(deps, scenario, dept, r.commitmentId, r.decision, r.reason, env);
  }
  if (output.sacrificeStance === 'REFUSE') postRefusal(deps, scenario, dept, output.additionalReturnNeeded ? [output.additionalReturnNeeded] : [], env);
}
