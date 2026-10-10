// Promises across cycles (agent memory and fairness): DUE → FULFILLED / BREACHED, and the trust it moves.
// Deterministic; the orchestrator applies the results.
import { DEPARTMENT_LABEL } from '@/domain/constants';
import type { AgentId, Commitment, DepartmentId, ModeTier, Plan, Scenario } from '@/domain/types';
import { sacrificeModeOf, tierOf } from './catalog';
import type { RankedPlan } from './optimizer';

export const TRUST_FULFILLED = 0.2;
export const TRUST_BREACHED = -0.4;

const TIER_RANK: Record<ModeTier, number> = { SACRIFICE: 1, RESTRICTED: 2, STANDARD: 3 };

export interface Settlement {
  id: string;
  to: 'FULFILLED' | 'BREACHED';
  reason: string;
  /** Avoidable breaches cost trust; unavoidable ones are recorded without a penalty. */
  avoidable: boolean;
  trustDelta: number;
  owner: AgentId;
  beneficiary: DepartmentId;
}

export const clampTrust = (v: number): number => Math.max(-1, Math.min(1, Math.round(v * 100) / 100));

/**
 * Settle promises that fell DUE when this scenario opened, using the plan that was just approved.
 * `feasibleAll` = every plan that was feasible for the scenario under any policy the council may use.
 * `earlierPlan` = the approved plan from before the event (to compare tiers for FUTURE_RESOURCE promises).
 */
export function settleAtApproval(
  commitments: readonly Commitment[],
  scenario: Pick<Scenario, 'id'>,
  plan: Pick<Plan, 'version' | 'selections' | 'sacrifices'>,
  feasibleAll: readonly Pick<RankedPlan, 'selections'>[],
  earlierPlan?: Pick<Plan, 'selections'> | null,
): Settlement[] {
  const out: Settlement[] = [];
  for (const c of commitments) {
    if (c.status !== 'DUE' || c.scenarioId === scenario.id) continue;
    const d = c.beneficiary;
    const label = DEPARTMENT_LABEL[d];
    if (c.kind === 'PRIORITY') {
      if (!plan.sacrifices.includes(d)) {
        out.push({ id: c.id, to: 'FULFILLED', reason: `${label} was not asked to sacrifice in v${plan.version}: first priority honoured.`, avoidable: false, trustDelta: TRUST_FULFILLED, owner: c.owner, beneficiary: d });
        continue;
      }
      const sacrificeMode = sacrificeModeOf(d);
      const alternative = feasibleAll.some((p) => p.selections[d] !== sacrificeMode);
      out.push(
        alternative
          ? { id: c.id, to: 'BREACHED', reason: `${label} sacrificed in v${plan.version} although a feasible plan without that sacrifice existed.`, avoidable: true, trustDelta: TRUST_BREACHED, owner: c.owner, beneficiary: d }
          : { id: c.id, to: 'BREACHED', reason: `unavoidable — only feasible plan requires ${sacrificeMode}`, avoidable: false, trustDelta: 0, owner: c.owner, beneficiary: d },
      );
    } else if (c.kind === 'FUTURE_RESOURCE') {
      const before = earlierPlan ? TIER_RANK[tierOf(earlierPlan.selections[d])] : 0;
      const after = TIER_RANK[tierOf(plan.selections[d])];
      out.push(
        after >= before
          ? { id: c.id, to: 'FULFILLED', reason: `${label} runs ${plan.selections[d]} in v${plan.version}, at least its previous tier.`, avoidable: false, trustDelta: TRUST_FULFILLED, owner: c.owner, beneficiary: d }
          : { id: c.id, to: 'BREACHED', reason: `${label} dropped from ${earlierPlan?.selections[d]} to ${plan.selections[d]} despite the increased supply.`, avoidable: true, trustDelta: TRUST_BREACHED, owner: c.owner, beneficiary: d },
      );
    }
  }
  return out;
}
