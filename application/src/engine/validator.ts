// The deterministic validator: pure TypeScript, no LLM involved, impossible to bypass.
import { DEPARTMENT_LABEL } from '@/domain/constants';
import { getMode, isModeId } from '@/domain/scenario';
import {
  DEPARTMENT_IDS,
  RESOURCE_KEYS,
  type ActivePolicy,
  type AgentId,
  type CheckId,
  type Commitment,
  type DepartmentId,
  type ModeId,
  type Plan,
  type ResourceVector,
  type Selections,
  type ValidationCheck,
  type ValidationReport,
  type ValidationStage,
  type Vote,
} from '@/domain/types';
import { PUBLISHED_FINGERPRINT, catalogFingerprint, selectionTotals } from './catalog';
import { affordabilityIssues, appliesTo, COUNTING_STATUSES, isExpired } from './commitments';
import { effectiveLimits, type ScenarioConstraints } from './policy';
import { capOf, fmtOverages, fmtVs, sub, vec } from './resources';
import { latestVotes } from './votes';

export interface ValidateInput {
  selections: Partial<Record<DepartmentId, ModeId | string>>;
  claimedPackages?: Partial<Record<ModeId, { resources: ResourceVector; risk: number }>>;
  claimedTotals?: { agentId: AgentId; totals: ResourceVector } | null;
  scenario: ScenarioConstraints & { policy: ActivePolicy; colonyHour: number; index: number };
  includedCommitments: readonly Commitment[];
  plan?: Pick<Plan, 'version' | 'hash' | 'status'>;
  latestVersionInScenario?: number;
  votes?: readonly Vote[];
  stage: ValidationStage;
  now: string;
}

const LABELS: Record<CheckId, string> = {
  MODE_SELECTION: 'One complete package per department',
  PACKAGE_INTEGRITY: 'Package values unchanged',
  FORBIDDEN_MODES: 'No forbidden modes',
  RESOURCES: 'Resources within the pool',
  RISK_LIMIT: 'Combined risk within the limit',
  SACRIFICE_LIMIT: 'Sacrifice modes within the limit',
  RETURN_AGREEMENT: 'Return agreement for every sacrifice',
  COMMITMENT_AFFORDABILITY: 'Commitments are affordable',
  PLAN_CURRENCY: 'Plan is the current version',
  VOTES: 'Four ACCEPT votes on this exact version',
};

export function validatePlan(input: ValidateInput): ValidationReport {
  const checks: ValidationCheck[] = [];
  const warnings: string[] = [];
  const add = (id: CheckId, status: ValidationCheck['status'], reason: string, details?: Record<string, unknown>) =>
    checks.push({ id, label: LABELS[id], status, reason, ...(details ? { details } : {}) });

  // 1 · MODE_SELECTION
  const selectionErrors: string[] = [];
  for (const dept of DEPARTMENT_IDS) {
    const sel = input.selections[dept];
    if (!sel) selectionErrors.push(`${DEPARTMENT_LABEL[dept]} has no mode selected`);
    else if (!isModeId(sel)) selectionErrors.push(`${sel} is not a published package`);
    else if (getMode(sel).department !== dept) selectionErrors.push(`${DEPARTMENT_LABEL[dept]} selected ${sel}, which is not a ${DEPARTMENT_LABEL[dept]} package`);
  }
  const validSelections = selectionErrors.length === 0 ? (input.selections as Selections) : null;
  add(
    'MODE_SELECTION',
    selectionErrors.length ? 'FAIL' : 'PASS',
    selectionErrors.length ? selectionErrors.join('; ') : `Exactly one published package each: ${DEPARTMENT_IDS.map((d) => input.selections[d]).join(' ')}`,
  );

  // 2 · PACKAGE_INTEGRITY
  const integrityErrors: string[] = [];
  if (catalogFingerprint() !== PUBLISHED_FINGERPRINT) integrityErrors.push('the published package catalog was modified at runtime');
  for (const [modeId, claimed] of Object.entries(input.claimedPackages ?? {})) {
    if (!claimed || !isModeId(modeId)) continue;
    const published = getMode(modeId);
    for (const key of RESOURCE_KEYS) {
      if (claimed.resources[key] !== published.resources[key]) {
        integrityErrors.push(`${modeId} claimed ${key} ${claimed.resources[key]} but the published package is ${published.resources[key]} — package values are immutable`);
      }
    }
    if (claimed.risk !== published.risk) integrityErrors.push(`${modeId} claimed risk ${claimed.risk} but the published risk is ${published.risk}`);
  }
  add(
    'PACKAGE_INTEGRITY',
    integrityErrors.length ? 'FAIL' : 'PASS',
    integrityErrors.length ? integrityErrors.join('; ') : `Published packages unchanged (catalog fingerprint ${PUBLISHED_FINGERPRINT})`,
  );

  const cap = capOf(input.scenario.pool, input.scenario.reserveRequirements);
  const computed = validSelections ? selectionTotals(validSelections) : null;
  const totals = computed?.totals ?? vec();
  const risk = computed?.risk ?? 0;
  const sacrifices = computed?.sacrifices ?? [];
  const reserve = sub(cap, totals);

  // 3 · FORBIDDEN_MODES
  if (input.scenario.forbiddenModes.length === 0) add('FORBIDDEN_MODES', 'SKIP', 'No modes are forbidden in this scenario');
  else if (!validSelections) add('FORBIDDEN_MODES', 'SKIP', 'Requires a valid mode selection');
  else {
    const hits = DEPARTMENT_IDS.filter((d) => input.scenario.forbiddenModes.includes(validSelections[d]));
    add(
      'FORBIDDEN_MODES',
      hits.length ? 'FAIL' : 'PASS',
      hits.length
        ? hits.map((d) => `${validSelections[d]} is unavailable in this scenario`).join('; ')
        : `None of ${input.scenario.forbiddenModes.join(', ')} selected`,
    );
  }

  // 4 · RESOURCES
  if (!computed) add('RESOURCES', 'SKIP', 'Requires a valid mode selection');
  else {
    const overages = fmtOverages(totals, cap);
    add('RESOURCES', overages ? 'FAIL' : 'PASS', overages || `All five resources within the pool (${fmtVs(totals, cap)})`, {
      totals,
      cap,
    });
  }

  // 5 · RISK_LIMIT and 6 · SACRIFICE_LIMIT (event caps bound every policy, Crisis Override included)
  const limits = effectiveLimits(input.scenario.policy, input.scenario);
  if (!computed) {
    add('RISK_LIMIT', 'SKIP', 'Requires a valid mode selection');
    add('SACRIFICE_LIMIT', 'SKIP', 'Requires a valid mode selection');
  } else {
    const capNote =
      input.scenario.riskCap !== null && input.scenario.riskCap < input.scenario.policy.riskLimit
        ? ` (event cap ${input.scenario.riskCap})`
        : input.scenario.policy.crisisOverride
          ? ' (Crisis Override active)'
          : '';
    add(
      'RISK_LIMIT',
      risk > limits.riskLimit ? 'FAIL' : 'PASS',
      risk > limits.riskLimit ? `Risk ${risk} > limit ${limits.riskLimit}${capNote}` : `Risk ${risk} ≤ ${limits.riskLimit}${capNote}`,
    );
    const sacrificeList = sacrifices.map((d) => `${d} ${validSelections![d]}`).join(', ');
    add(
      'SACRIFICE_LIMIT',
      sacrifices.length > limits.maxSacrifices ? 'FAIL' : 'PASS',
      sacrifices.length > limits.maxSacrifices
        ? `${sacrifices.length} Sacrifice modes (${sacrificeList}) > max ${limits.maxSacrifices}`
        : `${sacrifices.length} Sacrifice mode(s)${sacrificeList ? ` (${sacrificeList})` : ''} ≤ max ${limits.maxSacrifices}`,
    );
  }

  // 7 · RETURN_AGREEMENT
  if (!validSelections) add('RETURN_AGREEMENT', 'SKIP', 'Requires a valid mode selection');
  else if (sacrifices.length === 0) add('RETURN_AGREEMENT', 'SKIP', 'No Sacrifice mode selected: no return agreement required');
  else {
    const required = input.scenario.policy.requiredReturnCommitments;
    const parts: string[] = [];
    let ok = true;
    for (const dept of sacrifices) {
      const mode = validSelections[dept];
      const relevant = input.includedCommitments.filter((c) => appliesTo(c, dept, mode) && c.owner !== dept);
      const counting = relevant.filter(
        (c) => COUNTING_STATUSES.includes(c.status) && !isExpired(c, input.scenario.colonyHour, input.scenario.index),
      );
      const owners = new Set(counting.map((c) => c.owner));
      const pending = relevant.filter((c) => c.status === 'OFFERED');
      const passed = owners.size >= required;
      if (!passed) ok = false;
      parts.push(
        `${dept} (${mode}): ${owners.size}/${required} accepted returns from different agents` +
          (counting.length ? ` — ${counting.map((c) => `${c.id} by ${c.owner} ${c.status.toLowerCase()}`).join('; ')}` : '') +
          (pending.length ? `; pending: ${pending.map((c) => `${c.id} by ${c.owner}`).join(', ')}` : ''),
      );
    }
    add('RETURN_AGREEMENT', ok ? 'PASS' : 'FAIL', parts.join(' · '));
  }

  // 8 · COMMITMENT_AFFORDABILITY
  if (!validSelections) add('COMMITMENT_AFFORDABILITY', 'SKIP', 'Requires a valid mode selection');
  else {
    const relevant = input.includedCommitments.filter((c) => sacrifices.some((d) => appliesTo(c, d, validSelections[d])));
    if (relevant.length === 0) add('COMMITMENT_AFFORDABILITY', 'SKIP', 'No commitments included');
    else {
      const issues = affordabilityIssues(relevant, validSelections, reserve);
      add('COMMITMENT_AFFORDABILITY', issues.length ? 'FAIL' : 'PASS', issues.length ? issues.join('; ') : `${relevant.length} commitment(s) affordable within packages and reserve`);
    }
  }

  // 9 · PLAN_CURRENCY and 10 · VOTES (approval gate only)
  if (input.stage === 'APPROVAL') {
    const plan = input.plan;
    if (!plan) add('PLAN_CURRENCY', 'FAIL', 'No plan version supplied for approval');
    else if (input.latestVersionInScenario !== undefined && plan.version !== input.latestVersionInScenario) {
      add('PLAN_CURRENCY', 'FAIL', `v${plan.version} was superseded by v${input.latestVersionInScenario} — votes on v${plan.version} cannot approve`);
    } else if (plan.status === 'STALE' || plan.status === 'INVALID' || plan.status === 'SUPERSEDED') {
      add('PLAN_CURRENCY', 'FAIL', `v${plan.version} is ${plan.status}`);
    } else add('PLAN_CURRENCY', 'PASS', `v${plan.version} is the current plan version`);

    if (!plan) add('VOTES', 'FAIL', 'No plan version supplied for approval');
    else {
      const latest = latestVotes(input.votes ?? []);
      const lines: string[] = [];
      let accept = 0;
      for (const dept of DEPARTMENT_IDS) {
        const vote = latest.get(dept);
        if (!vote) lines.push(`${dept} has not voted`);
        else if (vote.planVersion !== plan.version || vote.planHash !== plan.hash) lines.push(`${dept} voted on another version`);
        else if (vote.decision !== 'ACCEPT') lines.push(`${dept} voted REJECT: "${vote.reason}"`);
        else accept++;
      }
      add('VOTES', accept === 4 ? 'PASS' : 'FAIL', accept === 4 ? `4/4 ACCEPT on v${plan.version}` : `${accept}/4 ACCEPT on v${plan.version} (${lines.join('; ')})`);
    }
  }

  // Warnings: agents' arithmetic and conflicting priority promises.
  if (input.claimedTotals && computed) {
    const mismatches = RESOURCE_KEYS.filter((k) => input.claimedTotals!.totals[k] !== totals[k]);
    if (mismatches.length) {
      warnings.push(
        `${input.claimedTotals.agentId} claimed ${mismatches.map((k) => `${k} ${input.claimedTotals!.totals[k]}`).join(', ')}; actual ${mismatches.map((k) => `${k} ${totals[k]}`).join(', ')} (corrected by the validator)`,
      );
    }
  }
  const priorities = input.includedCommitments.filter((c) => c.kind === 'PRIORITY' && /first priority/i.test(c.promise));
  const byOwner = new Map<string, Set<string>>();
  for (const c of priorities) byOwner.set(c.owner, (byOwner.get(c.owner) ?? new Set()).add(c.beneficiary));
  for (const [owner, beneficiaries] of byOwner) {
    if (beneficiaries.size > 1) warnings.push(`${owner} promised "first priority" to ${[...beneficiaries].join(' and ')}; both cannot be first`);
  }

  const status = checks.some((c) => c.status === 'FAIL') ? 'FAIL' : 'PASS';
  return {
    status,
    stage: input.stage,
    planVersion: input.plan?.version ?? null,
    planHash: input.plan?.hash ?? null,
    checks,
    totals,
    reserve,
    risk,
    sacrifices,
    warnings,
    evaluatedAt: input.now,
  };
}

export function failedChecks(report: ValidationReport): ValidationCheck[] {
  return report.checks.filter((c) => c.status === 'FAIL');
}

export function summarizeReport(report: ValidationReport): string {
  const failed = failedChecks(report);
  const counted = report.checks.filter((c) => c.status !== 'SKIP').length;
  if (failed.length === 0) return `PASS ${counted}/${counted} checks`;
  return `FAIL — ${failed.map((c) => `${c.id}: ${c.reason}`).join(' | ')}`;
}
