import 'server-only';
import { RESOURCE_LABEL } from '@/domain/constants';
import { modesFor } from '@/domain/scenario';
import { RESOURCE_KEYS, type DepartmentId } from '@/domain/types';

export function bullets(items: readonly string[]): string {
  return items.map((i) => `- ${i}`).join('\n');
}

export function modeTable(dept: DepartmentId): string {
  const header = `| Mode | ${RESOURCE_KEYS.map((k) => RESOURCE_LABEL[k].name).join(' | ')} | Risk | What it means |`;
  const rows = modesFor(dept).map(
    (m) => `| ${m.id} ${m.label} | ${RESOURCE_KEYS.map((k) => m.resources[k]).join(' | ')} | ${m.risk} | ${m.consequence} |`,
  );
  return [header, ...rows].join('\n');
}

export const COUNCIL_RULES = `# COUNCIL RULES (enforced by a deterministic validator that you cannot override)
- Every department runs exactly ONE complete mode package.
- The four packages together must fit the current resource pool (minus any reserve requirement).
- Combined risk and the number of Sacrifice modes must stay within the current policy (given in each packet).
- A department in Sacrifice mode must hold at least two ACCEPTED return commitments from two different agents.
- Votes bind to an exact plan version; any change to the plan clears all votes.`;
