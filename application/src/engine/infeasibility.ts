// Exhaustive-search proof that no allowed combination fits, plus the exact change that would fix it.
import { RESOURCE_LABEL } from '@/domain/constants';
import { RESOURCE_KEYS, type ActivePolicy, type InfeasibilityCertificate } from '@/domain/types';
import { allSacrificeFloorPolicy, effectiveLimits, overridePolicy, type ScenarioConstraints } from './policy';
import { evaluateAll, type CombinationEval } from './optimizer';
import { capOf, countPositive, fmtShortfall, total } from './resources';

export interface PolicyLevel {
  name: string;
  policy: ActivePolicy;
}

/** Combinations that satisfy the policy (risk, sacrifices, forbidden modes) ignoring resources, closest first. */
function policyAllowed(constraints: ScenarioConstraints, policy: ActivePolicy): CombinationEval[] {
  return evaluateAll(constraints, policy)
    .filter((e) => !e.violations.some((v) => v === 'RISK' || v === 'SACRIFICES' || v === 'FORBIDDEN'))
    .sort(
      (a, b) =>
        countPositive(a.overages) - countPositive(b.overages) ||
        total(a.overages) - total(b.overages) ||
        a.risk - b.risk ||
        a.key.localeCompare(b.key),
    );
}

function feasibleCount(constraints: ScenarioConstraints, policy: ActivePolicy): { count: number; best: CombinationEval | null } {
  const feasible = evaluateAll(constraints, policy).filter((e) => e.feasible);
  return { count: feasible.length, best: feasible.sort((a, b) => a.risk - b.risk || a.key.localeCompare(b.key))[0] ?? null };
}

export interface CertifyOptions {
  /** Policies the council may use right now: [current] or [current, crisis override]. */
  levels: PolicyLevel[];
  durationHours?: number | null;
}

export function certifyInfeasibility(constraints: ScenarioConstraints, options: CertifyOptions): InfeasibilityCertificate {
  const [current] = options.levels;
  if (!current) throw new Error('certifyInfeasibility needs at least one policy level');
  const cap = capOf(constraints.pool, constraints.reserveRequirements);
  const forDuration = options.durationHours ? ` for ${options.durationHours} h` : '';

  // The best permissible level is the most permissive policy the council can actually use (usually the last).
  const permissible = options.levels.map((level) => ({ level, allowed: policyAllowed(constraints, level.policy) }));
  const best = [...permissible].reverse().find((p) => p.allowed.length > 0) ?? permissible[permissible.length - 1]!;

  const blocking: InfeasibilityCertificate['blocking'] = [];
  if (best.allowed.length === 0) {
    const resourceFeasible = evaluateAll(constraints, allSacrificeFloorPolicy()).filter((e) => !e.violations.includes('RESOURCES'));
    const limits = effectiveLimits(best.level.policy, constraints);
    blocking.push({
      constraint: 'POLICY',
      detail:
        `No combination satisfies risk ≤ ${limits.riskLimit} with ≤ ${limits.maxSacrifices} Sacrifice mode(s)` +
        (constraints.forbiddenModes.length ? ` and without ${constraints.forbiddenModes.join(', ')}` : '') +
        (resourceFeasible.length
          ? `; the ${resourceFeasible.length} resource-feasible combinations need risk ≥ ${Math.min(...resourceFeasible.map((e) => e.risk))}.`
          : '.'),
    });
  } else {
    for (const key of RESOURCE_KEYS) {
      const minDemand = Math.min(...best.allowed.map((e) => e.totals[key]));
      if (minDemand > cap[key]) {
        const witness = best.allowed.find((e) => e.totals[key] === minDemand)!;
        blocking.push({
          constraint: key.toUpperCase(),
          detail: `${RESOURCE_LABEL[key].name}: minimum achievable demand ${minDemand} (${witness.key}) > available ${cap[key]}`,
        });
      }
    }
    if (blocking.length === 0) {
      const closest = best.allowed[0]!;
      blocking.push({
        constraint: 'COMBINATION',
        detail: `No allowed combination fits all five resources at once; closest is ${closest.key}, short ${fmtShortfall(closest.overages)}.`,
      });
    }
  }

  const closest = best.allowed.slice(0, 3).map((e) => ({
    selections: e.selections,
    shortfall: e.overages,
    risk: e.risk,
    sacrifices: e.sacrifices.length,
    policy: best.level.name,
  }));

  const requests: string[] = [];
  const top = best.allowed[0];
  if (top) {
    requests.push(`Request ${fmtShortfall(top.overages)}${forDuration} under ${best.level.name} (closest plan: ${top.key}).`);
  }
  for (const p of permissible) {
    if (p === best) continue;
    const alt = p.allowed[0];
    if (alt) requests.push(`Under ${p.level.name}: ${fmtShortfall(alt.overages)} needed (closest plan: ${alt.key}).`);
  }

  const policyAlternatives: InfeasibilityCertificate['policyAlternatives'] = [];
  const describe = (c: ScenarioConstraints, policy: ActivePolicy) => {
    const { count, best: bestPlan } = feasibleCount(c, policy);
    if (count > 0) return { feasible: true, detail: `${count} feasible plan(s), e.g. ${bestPlan!.key} (risk ${bestPlan!.risk})` };
    const near = policyAllowed(c, policy)[0];
    return {
      feasible: false,
      detail: near ? `still infeasible: closest ${near.key} is short ${fmtShortfall(near.overages)}` : 'still infeasible: no combination satisfies the policy',
    };
  };
  if (!options.levels.some((l) => l.policy.crisisOverride)) {
    policyAlternatives.push({ change: 'Invoke Crisis Override (risk ≤ 28, up to 2 Sacrifice modes)', ...describe(constraints, overridePolicy()) });
  }
  const strongest = options.levels[options.levels.length - 1]!.policy;
  if (constraints.riskCap !== null) {
    policyAlternatives.push({
      change: `Lift the event's risk cap (${constraints.riskCap} → ${strongest.riskLimit})`,
      ...describe({ ...constraints, riskCap: null }, strongest),
    });
  }
  if (constraints.maxSacrificesCap !== null) {
    policyAlternatives.push({
      change: `Lift the event's Sacrifice cap (${constraints.maxSacrificesCap})`,
      ...describe({ ...constraints, maxSacrificesCap: null }, strongest),
    });
  }
  if (constraints.forbiddenModes.length > 0) {
    policyAlternatives.push({
      change: `Lift forbidden modes ${constraints.forbiddenModes.join(', ')}`,
      ...describe({ ...constraints, forbiddenModes: [] }, strongest),
    });
  }
  if (Object.values(constraints.reserveRequirements).some((v) => (v ?? 0) > 0)) {
    policyAlternatives.push({ change: 'Release mandated reserves', ...describe({ ...constraints, reserveRequirements: {} }, strongest) });
  }
  const floor = allSacrificeFloorPolicy();
  policyAlternatives.push({
    change: 'Authorize 3–4 Sacrifice modes (risk ≤ 36), beyond Crisis Override',
    ...describe({ ...constraints, riskCap: null, maxSacrificesCap: null }, floor),
  });

  return {
    combinationsChecked: 81 * options.levels.length,
    policyEvaluated: best.level.policy,
    blocking,
    closest,
    requests,
    policyAlternatives,
  };
}

/** True when no level the council may use has a feasible plan (an exhaustive-search proof). */
export function provenInfeasible(constraints: ScenarioConstraints, levels: PolicyLevel[]): boolean {
  return levels.every((level) => feasibleCount(constraints, level.policy).count === 0);
}
