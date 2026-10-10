import { DEPARTMENT_IDS, type DepartmentId, type Plan, type Vote } from '@/domain/types';

/** The latest ballot of each department, in casting order. */
export function latestVotes(votes: readonly Vote[]): Map<DepartmentId, Vote> {
  const latest = new Map<DepartmentId, Vote>();
  for (const vote of votes) latest.set(vote.agentId, vote);
  return latest;
}

export interface Tally {
  accept: number;
  reject: number;
  pending: number;
  unanimous: boolean;
  byAgent: Partial<Record<DepartmentId, Vote>>;
}

/** Counts only ballots bound to this plan's exact version and hash. */
export function tally(plan: Pick<Plan, 'version' | 'hash' | 'votes'>): Tally {
  const latest = latestVotes(plan.votes.filter((v) => v.planVersion === plan.version && v.planHash === plan.hash));
  let accept = 0;
  let reject = 0;
  const byAgent: Partial<Record<DepartmentId, Vote>> = {};
  for (const dept of DEPARTMENT_IDS) {
    const vote = latest.get(dept);
    if (!vote) continue;
    byAgent[dept] = vote;
    if (vote.decision === 'ACCEPT') accept++;
    else reject++;
  }
  return { accept, reject, pending: 4 - accept - reject, unanimous: accept === 4, byAgent };
}
