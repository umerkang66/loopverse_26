import 'server-only';
import { DEPARTMENT_IDS, type SessionState } from '@/domain/types';
import { tally } from '@/engine/votes';
import { toOutputSchemaRecord } from './output-schema';

const SCHEMA_NOTE =
  'Each record follows the repository output_schema.json (round, agent_id, proposal, vote, risk_score, flag_human_review). ' +
  'The PDF scenario has five resources and no food rations, so food_rations is null and robot_time_units, bandwidth_units, ' +
  'mode_id, mode_tier, plan_version and plan_total_risk are added as extensions. vote is the latest ballot bound to this plan version.';

/**
 * final_allocation.json for one scenario (default: the latest). APPROVED → the approved plan; otherwise the outcome,
 * the last plan on the table (if any) and, for INFEASIBLE, the certificate.
 */
export function finalAllocation(s: SessionState, scenarioId?: string) {
  const sc = scenarioId ? s.scenarios.find((x) => x.id === scenarioId) : s.scenarios[s.scenarios.length - 1];
  if (!sc) return null;
  const approved = sc.approvedPlanVersion ? s.plans.find((p) => p.version === sc.approvedPlanVersion) : undefined;
  const plan = approved ?? [...s.plans].reverse().find((p) => p.scenarioId === sc.id);
  const report = plan ? ([...plan.validations].reverse().find((r) => r.stage === 'APPROVAL') ?? plan.validations[plan.validations.length - 1]) : undefined;
  const votes = plan ? tally(plan) : null;
  const decision = [...s.messages].reverse().find((m) => m.scenarioId === sc.id && (m.type === 'APPROVAL' || m.type === 'DECISION'));
  const commitments = plan ? s.commitments.filter((c) => plan.commitmentIds.includes(c.id)) : [];
  const proposals = s.messages.filter((m) => m.scenarioId === sc.id && m.type === 'PROPOSAL');

  return {
    schema_note: SCHEMA_NOTE,
    session_id: s.id,
    exported_at: new Date().toISOString(),
    scenario: {
      id: sc.id,
      kind: sc.kind,
      title: sc.title,
      colony_hour: sc.colonyHour,
      pool: sc.pool,
      reserve_requirements: sc.reserveRequirements,
      forbidden_modes: sc.forbiddenModes,
      policy: sc.policy,
      status: sc.status,
      rounds: sc.round,
    },
    decision: sc.outcome ?? sc.status,
    decision_reason: sc.outcomeReason,
    plan_version: plan?.version ?? null,
    plan_status: plan?.status ?? null,
    plan_hash: plan?.hash ?? null,
    selections: plan?.selections ?? null,
    validation: report
      ? {
          status: report.status,
          stage: report.stage,
          evaluated_at: report.evaluatedAt,
          failed_checks: report.checks.filter((c) => c.status === 'FAIL').map((c) => c.id),
          checks: report.checks.map((c) => ({ id: c.id, label: c.label, status: c.status, reason: c.reason })),
        }
      : null,
    totals: plan?.totals ?? null,
    reserve: plan?.reserve ?? null,
    total_risk: plan?.risk ?? null,
    sacrifices: plan?.sacrifices ?? [],
    votes: votes ? { accept: votes.accept, reject: votes.reject, pending: votes.pending, unanimous: votes.unanimous } : null,
    return_agreement: commitments.map((c) => ({
      id: c.id,
      owner: c.owner,
      beneficiary: c.beneficiary,
      kind: c.kind,
      resource: c.resource,
      amount: c.amount,
      promise: c.promise,
      expiry: c.expiry.label,
      status: c.status,
    })),
    commander_decision: decision
      ? { type: decision.type, outcome: decision.subtype, summary: decision.summary, statement: decision.body, source: decision.source, model: decision.meta?.model ?? null }
      : null,
    certificate: sc.certificate,
    records: plan
      ? DEPARTMENT_IDS.map((dept) => {
          const vote = votes?.byAgent[dept];
          const proposal = [...proposals].reverse().find((m) => m.from === dept);
          return toOutputSchemaRecord({
            round: vote?.round ?? plan.round,
            dept,
            modeId: plan.selections[dept],
            justification: vote?.reason ?? proposal?.body ?? plan.rationale,
            vote: vote?.decision ?? null,
            planVersion: plan.version,
            planTotalRisk: plan.risk,
            hitlThreshold: s.config.hitl.riskThreshold,
          });
        })
      : [],
  };
}
