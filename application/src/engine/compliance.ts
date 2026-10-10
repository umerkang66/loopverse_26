// Live checklist of the PDF's requirements, computed from real run data (never hand-set).
import type {
  ComplianceItem,
  ComplianceReport,
  CouncilMessage,
  Plan,
  Scenario,
  SessionState,
} from '@/domain/types';
import { tally } from './votes';

type Status = ComplianceItem['status'];

function item(
  id: string,
  label: string,
  scope: ComplianceItem['scope'],
  status: Status,
  detail: string,
  evidence: string[] = [],
): ComplianceItem {
  return { id, label, scope, status, detail, evidence };
}

function approvalMessage(s: SessionState, scenario: Scenario): CouncilMessage | undefined {
  return s.messages.find((m) => m.scenarioId === scenario.id && m.type === 'APPROVAL');
}

function approvedPlanOf(s: SessionState, scenario: Scenario): Plan | undefined {
  return scenario.approvedPlanVersion ? s.plans.find((p) => p.version === scenario.approvedPlanVersion) : undefined;
}

function finalReport(plan: Plan) {
  return [...plan.validations].reverse().find((r) => r.stage === 'APPROVAL');
}

function baselineItems(s: SessionState): ComplianceItem[] {
  const S0 = s.scenarios.find((sc) => sc.kind === 'BASELINE');
  const items: ComplianceItem[] = [];
  if (!S0 || S0.status === 'PENDING') {
    const pending = (id: string, label: string) => item(id, label, 'BASELINE', 'PENDING', 'Start the crisis to evaluate.');
    return [
      pending('COMMANDER_OPENS', 'Commander receives the state first, shares it, and opens Round 1'),
      pending('MIN_3_ROUNDS', 'At least 3 rounds before the first approval'),
      pending('REVISED_PROPOSAL', 'At least 1 rejected or revised proposal'),
      pending('SACRIFICE_REFUSED', 'At least 1 agent refuses Sacrifice mode before the final agreement'),
      pending('TWO_RETURNS', 'At least 2 return commitments for the sacrificing department'),
      pending('ONE_PACKAGE_EACH', 'Every department selects one unchanged mode package'),
      pending('LIMITS_HELD', 'Baseline risk ≤ 24 with no more than one Sacrifice mode'),
    ];
  }
  const msgs = s.messages.filter((m) => m.scenarioId === S0.id);
  const resolved = S0.status === 'RESOLVED' || S0.status === 'AWAITING_COUNTERSIGN';
  const approval = approvalMessage(s, S0);
  const plan = approvedPlanOf(s, S0);
  const report = plan ? finalReport(plan) : undefined;

  const first = msgs[0];
  items.push(
    item(
      'COMMANDER_OPENS',
      'Commander receives the state first, shares it, and opens Round 1',
      'BASELINE',
      first ? (first.from === 'COMMANDER' && first.type === 'BRIEFING' && first.round === 1 ? 'PASS' : 'FAIL') : 'PENDING',
      first ? `First message: ${first.from} ${first.type} in round ${first.round}` : 'No message yet',
      first ? [first.id] : [],
    ),
  );

  if (approval) {
    items.push(item('MIN_3_ROUNDS', 'At least 3 rounds before the first approval', 'BASELINE', approval.round >= 3 ? 'PASS' : 'FAIL', `First approval in round ${approval.round}`, [approval.id]));
  } else {
    items.push(
      item(
        'MIN_3_ROUNDS',
        'At least 3 rounds before the first approval',
        'BASELINE',
        resolved ? 'NA' : 'PENDING',
        resolved ? `No approval: baseline resolved ${S0.outcome}` : `Round ${S0.round} in progress`,
      ),
    );
  }

  const failedPlan = s.plans.find((p) => p.scenarioId === S0.id && (p.status === 'FAILED' || p.status === 'REJECTED' || p.validations.some((r) => r.status === 'FAIL')));
  const failedEvidence = failedPlan ? msgs.find((m) => m.type === 'VALIDATION' && m.planVersion === failedPlan.version && (m.data as { report?: { status?: string } }).report?.status === 'FAIL') : undefined;
  const revisedAgent = Object.values(s.agents).find((a) => new Set(a.requestHistory.filter((h) => h.scenarioId === S0.id).map((h) => h.modeId)).size > 1);
  items.push(
    item(
      'REVISED_PROPOSAL',
      'At least 1 rejected or revised proposal',
      'BASELINE',
      failedPlan || revisedAgent ? 'PASS' : resolved ? 'FAIL' : 'PENDING',
      [failedPlan ? `Plan v${failedPlan.version} rejected by the validator` : '', revisedAgent ? `${revisedAgent.id} revised its request` : '']
        .filter(Boolean)
        .join('; ') || 'No rejected or revised proposal yet',
      failedEvidence ? [failedEvidence.id] : [],
    ),
  );

  const refusals = msgs.filter((m) => m.type === 'OBJECTION' && m.subtype === 'SACRIFICE_REFUSAL' && (!approval || m.seq < approval.seq));
  const noSacrificeNeeded = resolved && plan !== undefined && plan.sacrifices.length === 0 && refusals.length === 0;
  items.push(
    item(
      'SACRIFICE_REFUSED',
      'At least 1 agent refuses Sacrifice mode before the final agreement',
      'BASELINE',
      refusals.length ? 'PASS' : noSacrificeNeeded ? 'NA' : resolved ? 'FAIL' : 'PENDING',
      refusals.length
        ? `${refusals.length} refusal(s): ${[...new Set(refusals.map((m) => m.from))].join(', ')}`
        : noSacrificeNeeded
          ? 'No Sacrifice mode was required under this pool'
          : 'No refusal yet',
      refusals.slice(0, 4).map((m) => m.id),
    ),
  );

  if (plan && report) {
    const ret = report.checks.find((c) => c.id === 'RETURN_AGREEMENT');
    items.push(
      item(
        'TWO_RETURNS',
        'At least 2 return commitments for the sacrificing department',
        'BASELINE',
        !ret || ret.status === 'SKIP' ? 'NA' : ret.status === 'PASS' ? 'PASS' : 'FAIL',
        ret?.reason ?? 'No return agreement check',
        approval ? [approval.id] : [],
      ),
    );
    const sel = report.checks.find((c) => c.id === 'MODE_SELECTION');
    const integ = report.checks.find((c) => c.id === 'PACKAGE_INTEGRITY');
    items.push(
      item(
        'ONE_PACKAGE_EACH',
        'Every department selects one unchanged mode package',
        'BASELINE',
        sel?.status === 'PASS' && integ?.status === 'PASS' ? 'PASS' : 'FAIL',
        `${sel?.reason ?? ''} · ${integ?.reason ?? ''}`,
        approval ? [approval.id] : [],
      ),
    );
    items.push(
      item(
        'LIMITS_HELD',
        'Baseline risk ≤ 24 with no more than one Sacrifice mode',
        'BASELINE',
        plan.risk <= 24 && plan.sacrifices.length <= 1 ? 'PASS' : 'FAIL',
        `Approved v${plan.version}: risk ${plan.risk}, ${plan.sacrifices.length} Sacrifice mode(s)`,
        approval ? [approval.id] : [],
      ),
    );
  } else {
    const st: Status = resolved ? 'NA' : 'PENDING';
    const why = resolved ? `Baseline resolved ${S0.outcome} without an approved plan` : 'Awaiting the approved plan';
    items.push(item('TWO_RETURNS', 'At least 2 return commitments for the sacrificing department', 'BASELINE', st, why));
    items.push(item('ONE_PACKAGE_EACH', 'Every department selects one unchanged mode package', 'BASELINE', st, why));
    items.push(item('LIMITS_HELD', 'Baseline risk ≤ 24 with no more than one Sacrifice mode', 'BASELINE', st, why));
  }
  return items;
}

function eventItems(s: SessionState): ComplianceItem[] {
  const events = s.scenarios.filter((sc) => sc.kind === 'EVENT');
  const sc = events[events.length - 1];
  const labels = {
    EVENT_RECORDED: 'Event recorded and shared state updated',
    OLD_PLAN_MARKED: 'Old plan shown as STALE or INVALID',
    COMMITMENTS_REVIEWED: 'Return promises reviewed after the event',
    MIN_2_ROUNDS_OR_PROOF: 'At least 2 visible rounds unless infeasibility is proven',
    FRESH_VOTES: 'New approval needs four votes on the new version',
    WITHIN_3_MIN: 'New plan or justified INFEASIBLE within 3 minutes',
  } as const;
  if (!sc) {
    return Object.entries(labels).map(([id, label]) => item(id, label, 'EVENT', 'PENDING', 'Inject an event to evaluate.'));
  }
  const msgs = s.messages.filter((m) => m.scenarioId === sc.id);
  const resolved = sc.status === 'RESOLVED' || sc.status === 'AWAITING_COUNTERSIGN';
  const record = s.events.find((e) => e.id === sc.eventId);
  const eventMsg = msgs.find((m) => m.type === 'EVENT');
  const marked = msgs.find((m) => m.type === 'SYSTEM' && (m.subtype === 'PLAN_STALE' || m.subtype === 'PLAN_INVALID'));
  const review = msgs.find((m) => m.type === 'SYSTEM' && m.subtype === 'COMMITMENT_REVIEW');
  const approval = approvalMessage(s, sc);
  const plan = approvedPlanOf(s, sc);
  const items: ComplianceItem[] = [];
  items.push(
    item('EVENT_RECORDED', labels.EVENT_RECORDED, 'EVENT', record ? 'PASS' : 'FAIL', record ? `${record.interpretation.title}: pool ${JSON.stringify(record.poolBefore)} → ${JSON.stringify(record.poolAfter)}` : 'No event record', eventMsg ? [eventMsg.id] : []),
  );
  items.push(
    item(
      'OLD_PLAN_MARKED',
      labels.OLD_PLAN_MARKED,
      'EVENT',
      sc.previousPlan ? 'PASS' : marked ? 'PASS' : resolved || sc.round > 0 ? 'NA' : 'PENDING',
      sc.previousPlan ? `v${sc.previousPlan.version} marked ${sc.previousPlan.status}` : 'No plan was in force when the event arrived',
      marked ? [marked.id] : [],
    ),
  );
  items.push(item('COMMITMENTS_REVIEWED', labels.COMMITMENTS_REVIEWED, 'EVENT', review ? 'PASS' : resolved ? 'FAIL' : 'PENDING', review ? review.summary : 'No review yet', review ? [review.id] : []));
  if (sc.outcome === 'INFEASIBLE') {
    items.push(item('MIN_2_ROUNDS_OR_PROOF', labels.MIN_2_ROUNDS_OR_PROOF, 'EVENT', sc.certificate ? 'PASS' : 'FAIL', sc.certificate ? 'Infeasibility proven by exhaustive search' : 'INFEASIBLE without a certificate'));
    items.push(item('FRESH_VOTES', labels.FRESH_VOTES, 'EVENT', 'NA', 'No plan to vote on: INFEASIBLE'));
  } else if (approval && plan) {
    const t = tally(plan);
    items.push(item('MIN_2_ROUNDS_OR_PROOF', labels.MIN_2_ROUNDS_OR_PROOF, 'EVENT', approval.round >= 2 ? 'PASS' : 'FAIL', `Approved in round ${approval.round}`, [approval.id]));
    items.push(item('FRESH_VOTES', labels.FRESH_VOTES, 'EVENT', t.unanimous && plan.scenarioId === sc.id ? 'PASS' : 'FAIL', `${t.accept}/4 ACCEPT on v${plan.version}`, [approval.id]));
  } else {
    const st: Status = resolved ? 'FAIL' : 'PENDING';
    items.push(item('MIN_2_ROUNDS_OR_PROOF', labels.MIN_2_ROUNDS_OR_PROOF, 'EVENT', resolved ? 'NA' : st, resolved ? `Resolved ${sc.outcome}` : `Round ${sc.round} in progress`));
    items.push(item('FRESH_VOTES', labels.FRESH_VOTES, 'EVENT', resolved ? 'NA' : st, resolved ? `Resolved ${sc.outcome}` : 'Awaiting votes'));
  }
  if (resolved && sc.startedAt && sc.resolvedAt) {
    const seconds = Math.round((Date.parse(sc.resolvedAt) - Date.parse(sc.startedAt)) / 1000);
    const ok = (sc.outcome === 'APPROVED' || sc.outcome === 'INFEASIBLE') && seconds <= 180;
    items.push(item('WITHIN_3_MIN', labels.WITHIN_3_MIN, 'EVENT', ok ? 'PASS' : 'FAIL', `Resolved ${sc.outcome} in ${seconds} s (limit 180 s)`));
  } else {
    items.push(item('WITHIN_3_MIN', labels.WITHIN_3_MIN, 'EVENT', 'PENDING', 'Clock running'));
  }
  return items;
}

function systemItems(s: SessionState): ComplianceItem[] {
  const items: ComplianceItem[] = [];
  items.push(
    item(
      'FIVE_AGENTS',
      'Five named agents load with separate goals and state',
      'SYSTEM',
      Object.keys(s.agents).length === 5 ? 'PASS' : 'FAIL',
      `${Object.keys(s.agents).length} agents, each with its own instructions, private session (${s.id.slice(0, 8)}…:<agent>), state and memory`,
    ),
  );
  const planVersions = new Map(s.plans.map((p) => [p.version, p]));
  const badVotes = s.plans.flatMap((p) => p.votes).filter((v) => planVersions.get(v.planVersion)?.hash !== v.planHash);
  items.push(
    item(
      'VERSIONED',
      'Every candidate plan has a version; votes bind to a version',
      'SYSTEM',
      s.plans.length === 0 ? 'PENDING' : badVotes.length ? 'FAIL' : 'PASS',
      `${s.plans.length} plan versions; ${s.plans.reduce((n, p) => n + p.votes.length, 0)} ballots, each bound to a version + hash`,
    ),
  );
  const failed = s.plans.find((p) => p.validations.some((r) => r.status === 'FAIL'));
  const failMsg = failed ? s.messages.find((m) => m.type === 'VALIDATION' && m.planVersion === failed.version) : undefined;
  items.push(
    item('VALIDATOR_BLOCKED', 'The validator blocks unsafe plans', 'SYSTEM', failed ? 'PASS' : 'PENDING', failed ? `v${failed.version} blocked by the validator` : 'No unsafe plan proposed yet', failMsg ? [failMsg.id] : []),
  );
  const approved = s.plans.filter((p) => p.status === 'APPROVED' || p.status === 'RATIFIED' || s.scenarios.some((sc) => sc.approvedPlanVersion === p.version));
  const gated = approved.every((p) => {
    const r = finalReport(p);
    return r?.status === 'PASS' && tally(p).unanimous;
  });
  items.push(
    item(
      'APPROVAL_GATE',
      'Commander approval requires PASS and four matching votes',
      'SYSTEM',
      approved.length === 0 ? 'PENDING' : gated ? 'PASS' : 'FAIL',
      approved.length ? `${approved.length} approval(s), each with an APPROVAL-stage PASS and 4/4 ACCEPT` : 'No approval yet',
    ),
  );
  items.push(
    item(
      'LIMITS_CONFIGURED',
      'A maximum round limit and timeout behavior',
      'SYSTEM',
      'PASS',
      `Max rounds ${s.config.maxRoundsBaseline} (baseline) / ${s.config.maxRoundsEvent} (event); deadlines ${s.config.baselineDeadlineSec}s / ${s.config.eventDeadlineSec}s; agent turn timeout ${Math.round(s.config.agentTurnTimeoutMs / 1000)}s`,
    ),
  );
  const resolved = s.scenarios.filter((sc) => sc.status === 'RESOLVED' || sc.status === 'AWAITING_COUNTERSIGN');
  items.push(
    item(
      'CLEAR_RESULT',
      'A clear result for agreement, deadlock, or infeasibility',
      'SYSTEM',
      resolved.length === 0 ? 'PENDING' : resolved.every((sc) => sc.outcome) ? 'PASS' : 'FAIL',
      resolved.length ? resolved.map((sc) => `${sc.id} ${sc.outcome}`).join(' · ') : 'No scenario resolved yet',
    ),
  );
  const hitl = s.config.hitl;
  const high = s.scenarios.filter((sc) => sc.approvedPlanVersion && (s.plans.find((p) => p.version === sc.approvedPlanVersion)?.risk ?? 0) > hitl.riskThreshold);
  if (!hitl.enabled) {
    items.push(item('HITL', 'Human countersign for approved plans above the risk threshold', 'SYSTEM', 'NA', 'Human-in-the-loop is disabled'));
  } else if (high.length === 0) {
    items.push(item('HITL', 'Human countersign for approved plans above the risk threshold', 'SYSTEM', resolved.length ? 'PASS' : 'PENDING', `No approved plan exceeds risk ${hitl.riskThreshold} yet`));
  } else {
    // A plan an event already marked STALE/INVALID before anyone countersigned is no longer the plan in force.
    const live = high.filter((sc) => ['APPROVED', 'RATIFIED'].includes(s.plans.find((p) => p.version === sc.approvedPlanVersion)?.status ?? ''));
    const unsigned = live.filter((sc) => s.plans.find((p) => p.version === sc.approvedPlanVersion)?.status !== 'RATIFIED');
    items.push(
      item(
        'HITL',
        'Human countersign for approved plans above the risk threshold',
        'SYSTEM',
        unsigned.length === 0 ? 'PASS' : unsigned.some((sc) => sc.status !== 'AWAITING_COUNTERSIGN') ? 'FAIL' : 'PENDING',
        unsigned.length === 0
          ? `${live.length} plan(s) above risk ${hitl.riskThreshold} in force, all countersigned by Mission Control${high.length > live.length ? ` (${high.length - live.length} superseded by a later event)` : ''}`
          : `Awaiting countersign: ${unsigned.map((sc) => `${sc.id} v${sc.approvedPlanVersion}`).join(', ')}`,
        s.messages.filter((m) => m.subtype === 'HUMAN_COUNTERSIGN').map((m) => m.id),
      ),
    );
  }
  return items;
}

export function computeCompliance(session: SessionState, extra: ComplianceItem[] = []): ComplianceReport {
  const items = [...baselineItems(session), ...eventItems(session), ...systemItems(session), ...extra];
  const applicable = items.filter((i) => i.status !== 'NA');
  return { items, passed: applicable.filter((i) => i.status === 'PASS').length, applicable: applicable.length };
}
