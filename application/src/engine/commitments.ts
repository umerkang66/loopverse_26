import { DEPARTMENT_LABEL, RESOURCE_LABEL } from '@/domain/constants';
import type {
  Commitment,
  CommitmentStatus,
  DepartmentId,
  ModeId,
  ResourceVector,
  Scenario,
  Selections,
} from '@/domain/types';
import { getMode } from '@/domain/scenario';
import { sacrificeModeOf, selectionTotals } from './catalog';
import type { RankedPlan } from './optimizer';
import { capOf, sub } from './resources';

export const LIVE_STATUSES: readonly CommitmentStatus[] = ['OFFERED', 'ACCEPTED', 'ACTIVE'];
export const COUNTING_STATUSES: readonly CommitmentStatus[] = ['ACCEPTED', 'ACTIVE'];

export function scenarioIndexOf(scenarioId: string): number {
  const n = Number.parseInt(scenarioId.replace(/^S/, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

/** HOURS expire on the colony clock; CYCLES/SCENARIOS expire when that many later scenarios have opened. */
export function isExpired(c: Commitment, colonyHour: number, scenarioIndex: number): boolean {
  if (c.expiry.unit === 'HOURS') return colonyHour > c.createdAtHour + c.expiry.value;
  return scenarioIndex - scenarioIndexOf(c.scenarioId) > c.expiry.value;
}

/** Does this commitment apply to `beneficiary` running `modeId`? (conditional offers name a sacrifice mode) */
export function appliesTo(c: Commitment, beneficiary: DepartmentId, modeId: ModeId): boolean {
  return c.beneficiary === beneficiary && (c.onlyIfSacrificeMode === null || c.onlyIfSacrificeMode === modeId);
}

/** Commitments that would form the return agreement for the sacrificing departments of `selections`. */
export function relevantCommitments(commitments: readonly Commitment[], selections: Selections): Commitment[] {
  const { sacrifices } = selectionTotals(selections);
  return commitments.filter(
    (c) => LIVE_STATUSES.includes(c.status) && sacrifices.some((dept) => appliesTo(c, dept, selections[dept])),
  );
}

/** Affordability problems for commitments included in a plan (empty = all affordable). */
export function affordabilityIssues(
  included: readonly Commitment[],
  selections: Selections,
  reserve: ResourceVector,
): string[] {
  const issues: string[] = [];
  const shares = new Map<string, number>();
  const assignments = new Map<string, number>();
  for (const c of included) {
    if (!LIVE_STATUSES.includes(c.status)) continue;
    if (c.kind === 'RESOURCE_SHARE') {
      if (c.owner === 'COMMANDER') {
        issues.push(`${c.id}: the Commander has no package to share; use a reserve assignment instead`);
        continue;
      }
      if (!c.resource || !c.amount || c.amount <= 0) {
        issues.push(`${c.id}: a resource share needs a resource and a positive amount`);
        continue;
      }
      const key = `${c.owner}:${c.resource}`;
      const used = (shares.get(key) ?? 0) + c.amount;
      shares.set(key, used);
      const ownerPackage = getMode(selections[c.owner]).resources[c.resource];
      if (used > ownerPackage) {
        issues.push(
          `${c.id}: ${DEPARTMENT_LABEL[c.owner]} shares ${used} ${RESOURCE_LABEL[c.resource].name} but its ${selections[c.owner]} package has only ${ownerPackage}`,
        );
      }
    } else if (c.kind === 'RESERVE_ASSIGNMENT') {
      if (c.owner !== 'COMMANDER') {
        issues.push(`${c.id}: only the Commander can assign the colony reserve`);
        continue;
      }
      if (!c.resource || !c.amount || c.amount <= 0) {
        issues.push(`${c.id}: a reserve assignment needs a resource and a positive amount`);
        continue;
      }
      const used = (assignments.get(c.resource) ?? 0) + c.amount;
      assignments.set(c.resource, used);
      if (used > reserve[c.resource]) {
        issues.push(
          `${c.id} assigns ${used} ${RESOURCE_LABEL[c.resource].name} from reserve, but plan reserve is ${reserve[c.resource]}`,
        );
      }
    }
  }
  return issues;
}

export interface ReviewItem {
  id: string;
  from: CommitmentStatus;
  to: CommitmentStatus;
  reason: string;
}

/**
 * Post-event review (PDF §06 step 3): remove or renegotiate promises whose cost or owner is no longer valid.
 * `feasible` = plans feasible in the new scenario under any policy the council may use.
 */
export function reviewAfterEvent(
  commitments: readonly Commitment[],
  scenario: Pick<Scenario, 'id' | 'index' | 'colonyHour' | 'pool' | 'reserveRequirements'>,
  feasible: readonly RankedPlan[],
): ReviewItem[] {
  const items: ReviewItem[] = [];
  const cap = capOf(scenario.pool, scenario.reserveRequirements);
  for (const c of commitments) {
    if (c.scenarioId === scenario.id) continue;
    const expired = isExpired(c, scenario.colonyHour, scenario.index);
    if (c.status === 'OFFERED' || c.status === 'ACCEPTED' || c.status === 'DECLINED') {
      items.push({ id: c.id, from: c.status, to: 'WITHDRAWN', reason: 'Offer from an earlier scenario that never became part of an approved plan.' });
      continue;
    }
    if (c.status === 'DUE') {
      if (expired) items.push({ id: c.id, from: 'DUE', to: 'EXPIRED', reason: `Expired (${c.expiry.label}).` });
      continue;
    }
    if (c.status !== 'ACTIVE') continue;
    if (expired) {
      items.push({ id: c.id, from: 'ACTIVE', to: 'EXPIRED', reason: `Expired (${c.expiry.label}).` });
      continue;
    }
    if (c.kind === 'PRIORITY' || c.kind === 'FUTURE_RESOURCE') {
      items.push({
        id: c.id,
        from: 'ACTIVE',
        to: 'DUE',
        reason: `Owed this cycle to ${DEPARTMENT_LABEL[c.beneficiary]}: "${c.promise}".`,
      });
      continue;
    }
    if (c.kind === 'RESOURCE_SHARE' || c.kind === 'RESERVE_ASSIGNMENT') {
      const mode = c.onlyIfSacrificeMode ?? sacrificeModeOf(c.beneficiary);
      const stillNeeded = feasible.filter((p) => p.selections[c.beneficiary] === mode);
      const affordable = stillNeeded.find(
        (p) => affordabilityIssues([c], p.selections, sub(cap, selectionTotals(p.selections).totals)).length === 0,
      );
      if (affordable) {
        items.push({ id: c.id, from: 'ACTIVE', to: 'ACTIVE', reason: `Carried: still affordable (e.g. in ${affordable.key}).` });
      } else if (stillNeeded.length === 0) {
        items.push({
          id: c.id,
          from: 'ACTIVE',
          to: 'VOID',
          reason: `Not needed: no feasible plan asks ${DEPARTMENT_LABEL[c.beneficiary]} to run ${mode}.`,
        });
      } else {
        items.push({ id: c.id, from: 'ACTIVE', to: 'VOID', reason: 'Cost no longer affordable under the new pool; must be renegotiated.' });
      }
    }
  }
  return items;
}
