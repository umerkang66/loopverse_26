import 'server-only';
import type { AgentId, InfeasibilityCertificate, Selections, SessionState } from '@/domain/types';
import { affordabilityIssues } from '@/engine/commitments';
import { evaluateCombination, fairnessFromState, feasiblePlans } from '@/engine/optimizer';
import { constraintsOf, overridePolicy } from '@/engine/policy';
import { capOf, sub } from '@/engine/resources';
import { certificateFor } from './view';

/** Read-only view of the deterministic engine for the agents' tools. Tools never mutate state. */
export interface EngineFacade {
  evaluate(selections: Selections): unknown;
  feasible(policy: 'CURRENT' | 'CRISIS_OVERRIDE'): unknown;
  certificate(): InfeasibilityCertificate | null;
  ledger(agentId: AgentId): unknown;
}

export function makeEngineFacade(getState: () => SessionState, scenarioId: string): EngineFacade {
  const scenario = () => {
    const sc = getState().scenarios.find((x) => x.id === scenarioId);
    if (!sc) throw new Error(`Unknown scenario ${scenarioId}`);
    return sc;
  };
  return {
    evaluate(selections) {
      const sc = scenario();
      const current = evaluateCombination(selections, constraintsOf(sc), sc.policy);
      const result: Record<string, unknown> = { underCurrentPolicy: current };
      if (sc.kind === 'EVENT' && sc.overrideAvailable && !sc.policy.crisisOverride) {
        result.underCrisisOverride = evaluateCombination(selections, constraintsOf(sc), overridePolicy());
      }
      return result;
    },
    feasible(policy) {
      const s = getState();
      const sc = scenario();
      const plans = feasiblePlans(constraintsOf(sc), policy === 'CRISIS_OVERRIDE' ? overridePolicy() : sc.policy, fairnessFromState(s, sc.id));
      return {
        policy,
        count: plans.length,
        plans: plans.slice(0, 8).map((p) => ({ rank: p.rank, key: p.key, totals: p.totals, risk: p.risk, sacrifices: p.sacrifices, reserve: p.reserve, why: p.why })),
      };
    },
    certificate() {
      return certificateFor(scenario());
    },
    ledger(agentId) {
      const s = getState();
      const sc = scenario();
      const cap = capOf(sc.pool, sc.reserveRequirements);
      return s.commitments
        .filter((c) => agentId === 'COMMANDER' || c.owner === agentId || c.beneficiary === agentId)
        .filter((c) => c.status !== 'WITHDRAWN')
        .map((c) => {
          const plan = [...s.plans].reverse().find((p) => p.scenarioId === sc.id);
          const issues = plan ? affordabilityIssues([c], plan.selections, sub(cap, plan.totals)) : [];
          return { ...c, history: undefined, affordableInLatestPlan: plan ? issues.length === 0 : null, issues };
        });
    },
  };
}
