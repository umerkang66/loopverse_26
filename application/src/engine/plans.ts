import { DEPARTMENT_LABEL } from '@/domain/constants';
import { getMode } from '@/domain/scenario';
import {
  DEPARTMENT_IDS,
  type ActivePolicy,
  type Commitment,
  type Plan,
  type PlanDiff,
  type ResourceVector,
  type Selections,
} from '@/domain/types';
import { fmtDelta, sub } from './resources';

/** JSON.stringify with recursively sorted object keys (stable across runs and machines). */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** The terms of a commitment (status excluded: accepting a commitment must not re-version the plan). */
export function commitmentTerms(c: Commitment) {
  return {
    id: c.id,
    owner: c.owner,
    beneficiary: c.beneficiary,
    kind: c.kind,
    resource: c.resource,
    amount: c.amount,
    promise: c.promise,
    expiry: c.expiry,
    onlyIfSacrificeMode: c.onlyIfSacrificeMode,
  };
}

export function canonicalPlanContent(input: {
  selections: Selections;
  commitments: readonly Commitment[];
  policy: ActivePolicy;
  pool: ResourceVector;
  reserveRequirements: Partial<ResourceVector>;
}): string {
  return stableStringify({
    selections: input.selections,
    commitments: [...input.commitments].sort((a, b) => a.id.localeCompare(b.id)).map(commitmentTerms),
    policy: input.policy,
    pool: input.pool,
    reserveRequirements: input.reserveRequirements,
  });
}

export function diffPlans(
  prev: Pick<Plan, 'version' | 'selections' | 'commitmentIds' | 'policy' | 'votes'>,
  next: Pick<Plan, 'selections' | 'commitmentIds' | 'policy'>,
): PlanDiff {
  const modeChanges: PlanDiff['modeChanges'] = [];
  for (const dept of DEPARTMENT_IDS) {
    const from = prev.selections[dept];
    const to = next.selections[dept];
    if (from === to) continue;
    const a = getMode(from);
    const b = getMode(to);
    modeChanges.push({ department: dept, from, to, delta: sub(b.resources, a.resources), riskDelta: b.risk - a.risk });
  }
  const commitmentsAdded = next.commitmentIds.filter((id) => !prev.commitmentIds.includes(id));
  const commitmentsRemoved = prev.commitmentIds.filter((id) => !next.commitmentIds.includes(id));
  const policyChanged =
    prev.policy.riskLimit !== next.policy.riskLimit ||
    prev.policy.maxSacrifices !== next.policy.maxSacrifices ||
    prev.policy.crisisOverride !== next.policy.crisisOverride;
  const parts: string[] = [];
  for (const change of modeChanges) {
    parts.push(
      `${DEPARTMENT_LABEL[change.department]} ${change.from}→${change.to} (${fmtDelta(change.delta)}, risk ${change.riskDelta >= 0 ? '+' : ''}${change.riskDelta})`,
    );
  }
  if (commitmentsAdded.length) parts.push(`+${commitmentsAdded.join(', +')}`);
  if (commitmentsRemoved.length) parts.push(`-${commitmentsRemoved.join(', -')}`);
  if (policyChanged) parts.push(`policy now risk ≤ ${next.policy.riskLimit}, ≤ ${next.policy.maxSacrifices} Sacrifice`);
  if (prev.votes.length) parts.push(`${prev.votes.length} vote(s) cleared`);
  return {
    fromVersion: prev.version,
    modeChanges,
    commitmentsAdded,
    commitmentsRemoved,
    policyChanged,
    summary: parts.length ? parts.join(' · ') : 'no change in terms',
  };
}
