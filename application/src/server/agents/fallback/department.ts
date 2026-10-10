import 'server-only';
import { DEPARTMENT_LABEL } from '@/domain/constants';
import { PROFILES, getMode, lossOf, referenceReturnsFor } from '@/domain/scenario';
import type { DepartmentId, ModeId, Plan, SacrificeStance, SessionState } from '@/domain/types';
import { restrictedModeOf, sacrificeModeOf, standardModeOf, TIER_RANK, tierOf } from '@/engine/catalog';
import { fmt } from '@/engine/resources';
import { failedChecks } from '@/engine/validator';
import { distinctOwners, offersTo, type ScenarioView } from '../../orchestrator/view';
import type { BallotOutput, ConsentOutput, DepartmentTurnOutput, NarrowSelections } from '../schemas';

/** Best (highest-tier) mode for `dept` among feasible plans in which it does NOT sacrifice. */
export function bestNonSacrificeMode(dept: DepartmentId, view: ScenarioView): ModeId {
  let best: ModeId | null = null;
  for (const p of view.effectiveFeasible) {
    const mode = p.selections[dept];
    if (tierOf(mode) === 'SACRIFICE') continue;
    if (!best || TIER_RANK[tierOf(mode)] > TIER_RANK[tierOf(best)]) best = mode;
  }
  return best ?? restrictedModeOf(dept);
}

function referenceConditions(dept: DepartmentId): string[] {
  return referenceReturnsFor(sacrificeModeOf(dept)).map((r) => r.promise);
}

export function fallbackDepartmentTurn(s: SessionState, view: ScenarioView, dept: DepartmentId, round: number): DepartmentTurnOutput {
  const sc = view.scenario;
  const sac = sacrificeModeOf(dept);
  const std = standardModeOf(dept);
  const plan = view.latestPlan;
  const designated = plan?.selections[dept] === sac;
  const candidate = view.candidates.includes(dept);
  const offers = offersTo(s, dept, sac);
  const owners = distinctOwners(offers);
  const required = sc.policy.requiredReturnCommitments;
  const loss = lossOf(sac) ?? getMode(sac).consequence;

  let requestedMode: ModeId;
  let sacrificeStance: SacrificeStance = 'NOT_ASKED';
  let sacrificeConditions: string[] = [];
  let counteroffer: DepartmentTurnOutput['counteroffer'] = null;
  let statement: string;
  const commitmentResponses: DepartmentTurnOutput['commitmentResponses'] = [];

  if (round === 1 && sc.kind === 'BASELINE') {
    requestedMode = std;
    const res = restrictedModeOf(dept);
    statement = `Requesting ${std} Standard (${fmt(getMode(std).resources)}). Restricted ${res} means: ${getMode(res).consequence} Sacrifice ${sac} means: ${loss}.`;
  } else if (view.provenInfeasible) {
    requestedMode = sac;
    sacrificeStance = 'CONDITIONAL';
    sacrificeConditions = sc.certificate?.requests.slice(0, 1) ?? ['external resupply'];
    statement = `My minimum viable package is ${sac} (${fmt(getMode(sac).resources)}). Even then the council needs ${sacrificeConditions[0] ?? 'an external resupply'}.`;
  } else if (designated) {
    if (owners >= required) {
      requestedMode = sac;
      sacrificeStance = 'ACCEPT';
      for (const c of offers.filter((o) => o.status === 'OFFERED')) {
        commitmentResponses.push({ commitmentId: c.id, decision: 'ACCEPT', reason: 'Concrete, affordable return for my sacrifice.' });
      }
      statement = `I accept ${sac} with ${offers.map((c) => c.id).join(', ')} as my return agreement. ${loss}`;
    } else {
      requestedMode = bestNonSacrificeMode(dept, view);
      sacrificeStance = 'REFUSE';
      sacrificeConditions = referenceConditions(dept);
      const alternative = view.effectiveFeasible.find((p) => p.selections[dept] !== sac);
      if (alternative) {
        counteroffer = {
          ...(alternative.selections as NarrowSelections),
          compensationTerms: `Returns for ${alternative.sacrifices.map((d) => DEPARTMENT_LABEL[d]).join(' and ')} per the council guide`,
          rationale: `${alternative.key} is also feasible (risk ${alternative.risk}, reserve ${fmt(alternative.reserve)}).`,
        };
      }
      statement = `I refuse ${sac} with only ${owners}/${required} returns. ${loss}. I need: ${sacrificeConditions.join('; ')}.`;
    }
  } else if (candidate && (round > 1 || sc.kind === 'EVENT')) {
    requestedMode = bestNonSacrificeMode(dept, view);
    sacrificeStance = owners >= required ? 'CONDITIONAL' : 'REFUSE';
    sacrificeConditions = referenceConditions(dept);
    statement =
      sacrificeStance === 'REFUSE'
        ? `I refuse ${sac} while no return is on the table: ${loss}. I would need: ${sacrificeConditions.join('; ')}.`
        : `I could accept ${sac} with ${offers.map((c) => c.id).join(', ')} if the council chooses my path.`;
  } else {
    requestedMode = bestNonSacrificeMode(dept, view);
    statement = `Holding ${requestedMode} ${getMode(requestedMode).label} (${fmt(getMode(requestedMode).resources)}); my Sacrifice mode is not needed in any feasible plan.`;
  }

  // Offer my reference returns to every department that may have to sacrifice.
  const commitmentOffers: DepartmentTurnOutput['commitmentOffers'] = [];
  if (round > 1 || sc.kind === 'EVENT') {
    const targets = new Set<DepartmentId>([...view.candidates, ...(plan?.sacrifices ?? [])]);
    targets.delete(dept);
    for (const beneficiary of targets) {
      const mode = sacrificeModeOf(beneficiary);
      for (const ref of referenceReturnsFor(mode)) {
        if (ref.owner !== dept || ref.kind === 'RESERVE_ASSIGNMENT') continue;
        const exists = s.commitments.some(
          (c) => c.owner === dept && c.beneficiary === beneficiary && c.promise === ref.promise && ['OFFERED', 'ACCEPTED', 'ACTIVE', 'DUE'].includes(c.status),
        );
        if (exists) continue;
        if (ref.kind === 'RESOURCE_SHARE' && ref.resource && ref.amount && getMode(requestedMode).resources[ref.resource] < ref.amount) continue;
        commitmentOffers.push({
          beneficiary: beneficiary as Exclude<DepartmentId, typeof dept>,
          kind: ref.kind as 'RESOURCE_SHARE' | 'PRIORITY' | 'FUTURE_RESOURCE' | 'OTHER',
          resource: ref.resource,
          amount: ref.amount,
          promise: ref.promise,
          expiry: ref.expiry,
          onlyIfSacrificeMode: mode as 'L3' | 'M3' | 'F3' | 'E3',
        });
      }
    }
  }

  const objections: DepartmentTurnOutput['objections'] = [];
  const report = plan?.validations[plan.validations.length - 1];
  const resources = report ? failedChecks(report).find((c) => c.id === 'RESOURCES') : undefined;
  if (resources && round > 1) objections.push({ kind: 'RESOURCE_CONFLICT', target: 'PLAN', detail: resources.reason });
  if (designated && owners < required) objections.push({ kind: 'MISSING_RETURN', target: 'COMMANDER', detail: `${sac} needs ${required} returns from different agents; I hold ${owners}.` });

  return {
    publicStatement: statement,
    requestedMode: requestedMode as DepartmentTurnOutput['requestedMode'],
    consequence: getMode(requestedMode).consequence,
    reason:
      round === 1 && sc.kind === 'BASELINE'
        ? `${PROFILES[dept].mission} needs the full ${std} package.`
        : `Feasible plans: ${view.effectiveFeasible.length}; ${requestedMode} keeps ${PROFILES[dept].mainConcern.toLowerCase()} within the pool.`,
    claimedTotals: null,
    sacrificeStance,
    sacrificeConditions,
    objections,
    counteroffer,
    commitmentOffers,
    commitmentResponses,
    privateNote: `${sc.id} R${round}: ${sacrificeStance === 'NOT_ASKED' ? 'not asked' : sacrificeStance} on ${sac}; ${owners} return owner(s) on the table; requested ${requestedMode}.`,
  };
}

export function fallbackConsent(s: SessionState, plan: Plan, dept: DepartmentId, required: number): ConsentOutput {
  const sac = plan.selections[dept];
  const included = s.commitments.filter((c) => plan.commitmentIds.includes(c.id) && c.beneficiary === dept);
  const pending = included.filter((c) => c.status === 'OFFERED');
  const owners = distinctOwners(included.filter((c) => ['OFFERED', 'ACCEPTED', 'ACTIVE'].includes(c.status)));
  const stance = owners >= required ? 'ACCEPT' : 'CONDITIONAL';
  return {
    statement:
      stance === 'ACCEPT'
        ? `I accept ${sac} for this plan with ${included.map((c) => c.id).join(', ')} as my return agreement.`
        : `I cannot accept ${sac} with ${owners}/${required} returns; I need another concrete return from a different agent.`,
    sacrificeStance: stance,
    responses: pending.map((c) => ({ commitmentId: c.id, decision: 'ACCEPT' as const, reason: 'Concrete and affordable.' })),
    additionalReturnNeeded: stance === 'ACCEPT' ? null : referenceConditions(dept).join('; '),
    privateNote: `Consent on v${plan.version}: ${stance}.`,
  };
}

export function fallbackBallot(s: SessionState, plan: Plan, dept: DepartmentId, required: number): BallotOutput {
  const report = [...plan.validations].reverse().find((r) => r.stage === 'PRE_VOTE');
  if (!report || report.status !== 'PASS') {
    const failed = report ? failedChecks(report)[0] : undefined;
    return {
      planVersion: plan.version,
      decision: 'REJECT',
      reason: failed ? `${failed.id}: ${failed.reason}` : 'The plan has not passed the validator.',
      conditionsForAccept: ['A validator PASS on this version'],
      privateNote: `Rejected v${plan.version}: not validated.`,
    };
  }
  if (plan.sacrifices.includes(dept)) {
    const accepted = s.commitments.filter((c) => plan.commitmentIds.includes(c.id) && c.beneficiary === dept && ['ACCEPTED', 'ACTIVE'].includes(c.status));
    const owners = distinctOwners(accepted);
    if (owners < required) {
      return {
        planVersion: plan.version,
        decision: 'REJECT',
        reason: `I would run ${plan.selections[dept]} with only ${owners}/${required} accepted returns.`,
        conditionsForAccept: referenceConditions(dept),
        privateNote: `Rejected v${plan.version}: missing returns.`,
      };
    }
    return {
      planVersion: plan.version,
      decision: 'ACCEPT',
      reason: `Validator PASS; my sacrifice ${plan.selections[dept]} carries ${accepted.map((c) => c.id).join(', ')}.`,
      conditionsForAccept: [],
      privateNote: `Accepted v${plan.version} as the sacrificing department.`,
    };
  }
  return {
    planVersion: plan.version,
    decision: 'ACCEPT',
    reason: `Validator PASS; ${plan.selections[dept]} fits my mission within the pool (risk ${plan.risk}).`,
    conditionsForAccept: [],
    privateNote: `Accepted v${plan.version}.`,
  };
}
