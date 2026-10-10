'use client';

import { AlertTriangle, ArrowRight, Check, Minus, Stamp, X, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RESOURCE_LABEL } from '@/domain/constants';

import {
  RESOURCE_KEYS,
  type ActorId,
  type Commitment,
  type CouncilMessage,
  type EventRecord,
  type InfeasibilityCertificate,
  type PlanDiff,
  type ResourceVector,
  type Scenario,
  type Selections,
  type ValidationReport,
  type Vote,
} from '@/domain/types';
import { capOf } from '@/engine/resources';
import { useAres } from '@/client/store';
import { ACTOR_META, OBJECTION_LABEL, TONE_CLASS } from '@/client/theme';
import { hash8, mmss } from '@/client/format';
import { ActorLabel, ModeChips, Pill, TierPill, Vec, VecVs, Verdict, VersionChip } from '../bits';
import { CertificateCard } from '../certificate-card';

type Data = Record<string, unknown>;
const d = <T,>(m: CouncilMessage) => m.data as T;

function Text({ children, className }: { children: string | null | undefined; className?: string }) {
  if (!children) return null;
  // Agent text is rendered as plain React text (escaped); never as HTML or Markdown.
  return <p className={cn('whitespace-pre-wrap break-words text-[13px] leading-relaxed', className)}>{children}</p>;
}

function useScenario(id: string): Scenario | null {
  return useAres((s) => s.state?.scenarios.find((x) => x.id === id) ?? null);
}

export function BriefingBody({ m }: { m: CouncilMessage }) {
  const { asks = [] } = d<{ asks?: { to: ActorId | 'ALL'; ask: string }[] }>(m);
  return (
    <>
      <Text>{m.body}</Text>
      {asks.length > 0 && (
        <ul className="mt-1 flex flex-col gap-0.5 text-[13px]">
          {asks.map((a, i) => (
            <li key={i} className="flex gap-1.5">
              <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-mars" aria-hidden />
              <span>
                <span className="font-semibold" style={{ color: a.to === 'ALL' ? undefined : ACTOR_META[a.to].color }}>
                  {a.to === 'ALL' ? 'ALL' : ACTOR_META[a.to].callsign}
                </span>
                : {a.ask}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function ProposalBody({ m }: { m: CouncilMessage }) {
  const data = d<{ modeId?: string; package?: { resources: ResourceVector; risk: number }; consequence?: string; reason?: string; conditions?: string[] }>(m);
  return (
    <>
      <Text>{m.body}</Text>
      {data.modeId && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-panel-2 px-2 py-1">
          <TierPill modeId={data.modeId} />
          {data.package && <Vec v={data.package.resources} />}
          {data.package && <span className="num text-xs text-muted-foreground">risk {data.package.risk}</span>}
        </div>
      )}
      {data.consequence && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">Consequence:</span> {data.consequence}
        </p>
      )}
      {data.reason && data.reason !== m.body && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">Reason:</span> {data.reason}
        </p>
      )}
      {data.conditions && data.conditions.length > 0 && (
        <p className="text-xs text-amber">Conditions: {data.conditions.join('; ')}</p>
      )}
    </>
  );
}

export function ObjectionBody({ m }: { m: CouncilMessage }) {
  const data = d<{ kind?: string; target?: string; detail?: string; conditions?: string[]; conflicts?: string[]; responses?: string[] }>(m);
  const kind = data.kind ?? m.subtype ?? 'OBJECTION';
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Pill tone="danger" icon={<AlertTriangle className="size-3" />}>
          {OBJECTION_LABEL[kind] ?? kind}
        </Pill>
        {data.target && (
          <span className="text-muted-foreground">
            target: <span className="text-foreground">{data.target === 'PLAN' ? 'the plan' : (ACTOR_META[data.target as ActorId]?.callsign ?? data.target)}</span>
          </span>
        )}
      </div>
      <Text>{m.body || data.detail}</Text>
      {data.conflicts && data.conflicts.length > 0 && (
        <ul className="list-inside list-disc text-[13px] text-muted-foreground">
          {data.conflicts.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}
      {data.responses && data.responses.length > 0 && (
        <ul className="list-inside list-disc text-[13px] text-muted-foreground">
          {data.responses.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}
    </>
  );
}

export function CounterofferBody({ m }: { m: CouncilMessage }) {
  const data = d<{ selections?: Selections; compensationTerms?: string; rationale?: string; dryRun?: ValidationReport; claimedTotals?: ResourceVector | null }>(m);
  const sc = useScenario(m.scenarioId);
  const cap = sc ? capOf(sc.pool, sc.reserveRequirements) : undefined;
  const firstFail = data.dryRun?.checks.find((c) => c.status === 'FAIL');
  const mismatch = data.claimedTotals && data.dryRun ? RESOURCE_KEYS.filter((k) => data.claimedTotals![k] !== data.dryRun!.totals[k]) : [];
  return (
    <>
      <Text>{data.rationale ?? m.body}</Text>
      {data.selections && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-panel-2 px-2 py-1">
          <ModeChips selections={data.selections} />
          {data.dryRun && <VecVs totals={data.dryRun.totals} cap={cap} />}
          {data.dryRun && <span className="num text-xs text-muted-foreground">risk {data.dryRun.risk}</span>}
        </div>
      )}
      {data.compensationTerms && (
        <p className="text-xs">
          <span className="font-medium text-muted-foreground">Compensation:</span> {data.compensationTerms}
        </p>
      )}
      {data.dryRun && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Verdict status={data.dryRun.status} label={<span className="font-normal opacity-80">dry run</span>} />
          {firstFail && (
            <span className="text-muted-foreground">
              {firstFail.id}: {firstFail.reason}
            </span>
          )}
        </div>
      )}
      {mismatch.length > 0 && (
        <p className="text-xs text-amber">
          ⚠ {ACTOR_META[m.from].callsign} claimed {mismatch.map((k) => `${RESOURCE_LABEL[k].short}${data.claimedTotals![k]}`).join(' ')} — actual{' '}
          {mismatch.map((k) => `${RESOURCE_LABEL[k].short}${data.dryRun!.totals[k]}`).join(' ')}
        </p>
      )}
    </>
  );
}

const COMMITMENT_TONE: Record<string, keyof typeof TONE_CLASS> = {
  OFFERED: 'info',
  ACCEPTED: 'success',
  ACTIVE: 'success',
  DUE: 'amber',
  FULFILLED: 'success',
  DECLINED: 'stale',
  WITHDRAWN: 'stale',
  VOID: 'stale',
  EXPIRED: 'stale',
  BREACHED: 'danger',
};

export function CommitmentLine({ c }: { c: Commitment }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
      <span className="num font-semibold">{c.id}</span>
      <span className="text-muted-foreground">·</span>
      <ActorLabel id={c.owner} dept={false} size={16} />
      <ArrowRight className="size-3 text-muted-foreground" aria-hidden />
      <ActorLabel id={c.beneficiary} dept={false} size={16} />
      <Pill tone={COMMITMENT_TONE[c.status] ?? 'muted'}>{c.status}</Pill>
    </div>
  );
}

export function CommitmentBody({ m }: { m: CouncilMessage }) {
  if (m.subtype === 'CONSENT') {
    const data = d<{ stance?: string; additionalReturnNeeded?: string | null }>(m);
    return (
      <>
        <div className="flex items-center gap-2 text-xs">
          <Pill tone={data.stance === 'ACCEPT' ? 'success' : data.stance === 'REFUSE' ? 'danger' : 'amber'}>Consent: {data.stance}</Pill>
          {data.additionalReturnNeeded && <span className="text-amber">needs: {data.additionalReturnNeeded}</span>}
        </div>
        <Text>{m.body}</Text>
      </>
    );
  }
  const data = d<{ commitmentId?: string; action?: string; commitment?: Commitment }>(m);
  const c = data.commitment;
  return (
    <>
      {c && <CommitmentLine c={c} />}
      {c && <p className="text-[13px]">“{c.promise}”</p>}
      {c && (
        <p className="num text-xs text-muted-foreground">
          {c.kind}
          {c.resource ? ` · ${RESOURCE_LABEL[c.resource].name}` : ''}
          {c.amount ? ` · ${c.amount}` : ''} · expires {c.expiry.label}
          {c.onlyIfSacrificeMode ? ` · only if ${c.onlyIfSacrificeMode}` : ''} · action {data.action ?? m.subtype}
        </p>
      )}
      {m.body && m.body !== c?.promise && <Text className="text-muted-foreground">{m.body}</Text>}
    </>
  );
}

export function PlanDraftBody({ m }: { m: CouncilMessage }) {
  const data = d<{
    version?: number;
    hash?: string;
    label?: string;
    selections?: Selections;
    totals?: ResourceVector;
    risk?: number;
    sacrifices?: string[];
    commitmentIds?: string[];
    diff?: PlanDiff | null;
    rationale?: string;
    respondsTo?: string[];
  }>(m);
  const sc = useScenario(m.scenarioId);
  const highlight = useAres((s) => s.highlight);
  const cap = sc ? capOf(sc.pool, sc.reserveRequirements) : undefined;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <VersionChip version={data.version} hash={data.hash} size="lg" />
        <span className="font-medium">{data.label}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-md bg-panel-2 px-2 py-1">
        {data.selections && <ModeChips selections={data.selections} />}
        {data.totals && <VecVs totals={data.totals} cap={cap} />}
        <span className="num text-xs text-muted-foreground">risk {data.risk}</span>
        {data.sacrifices && data.sacrifices.length > 0 && <Pill tone="danger">Sacrifice: {data.sacrifices.map((s) => ACTOR_META[s as ActorId].callsign).join(', ')}</Pill>}
      </div>
      {data.commitmentIds && data.commitmentIds.length > 0 && <p className="num text-xs text-muted-foreground">Includes {data.commitmentIds.join(', ')}</p>}
      {data.diff && (
        <p className="rounded-md border border-info/30 bg-info/5 px-2 py-1 text-xs">
          <span className="font-semibold text-info">Δ vs v{data.diff.fromVersion}:</span> {data.diff.summary}
        </p>
      )}
      <Text className="text-muted-foreground">{data.rationale && data.rationale !== m.body ? data.rationale : m.body}</Text>
      {data.respondsTo && data.respondsTo.length > 0 && (
        <p className="flex flex-wrap gap-1 text-xs text-muted-foreground">
          Responds to:
          {data.respondsTo.map((id) => (
            <button key={id} type="button" className="num text-info underline-offset-2 hover:underline" onClick={() => highlight(id)}>
              {id}
            </button>
          ))}
        </p>
      )}
    </>
  );
}

export function ChecksList({ report, open }: { report: ValidationReport; open?: boolean }) {
  return (
    <details open={open ?? report.status === 'FAIL'} className="group text-xs">
      <summary className="cursor-pointer text-muted-foreground select-none">
        {report.checks.filter((c) => c.status === 'PASS').length}/{report.checks.filter((c) => c.status !== 'SKIP').length} checks pass · {report.checks.length} checks
      </summary>
      <ul className="mt-1 flex flex-col gap-0.5">
        {report.checks.map((c) => {
          const Icon = c.status === 'PASS' ? Check : c.status === 'FAIL' ? X : Minus;
          return (
            <li key={c.id} className="flex gap-1.5">
              <Icon className={cn('mt-0.5 size-3.5 shrink-0', c.status === 'PASS' ? 'text-success' : c.status === 'FAIL' ? 'text-danger' : 'text-muted-foreground')} aria-label={c.status} />
              <span>
                <span className={cn('font-medium', c.status === 'FAIL' && 'text-danger')}>{c.label}</span>
                <span className="text-muted-foreground"> — {c.reason}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {report.warnings.length > 0 && (
        <ul className="mt-1 text-amber">
          {report.warnings.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      )}
    </details>
  );
}

export function ValidationBody({ m }: { m: CouncilMessage }) {
  const { report } = d<{ report?: ValidationReport }>(m);
  if (!report) return <Text>{m.body}</Text>;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Verdict status={report.status} />
        <span className="num text-xs text-muted-foreground">
          {report.stage} · v{report.planVersion} {hash8(report.planHash)} · risk {report.risk}
        </span>
      </div>
      <ChecksList report={report} />
    </>
  );
}

export function VoteBody({ m }: { m: CouncilMessage }) {
  const { vote } = d<{ vote?: Vote }>(m);
  if (!vote) return <Text>{m.body}</Text>;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={vote.decision === 'ACCEPT' ? 'success' : 'danger'} icon={vote.decision === 'ACCEPT' ? <Check className="size-3" /> : <X className="size-3" />}>
          {vote.decision}
        </Pill>
        <VersionChip version={vote.planVersion} hash={vote.planHash} />
      </div>
      <Text>{vote.reason}</Text>
      {vote.conditionsForAccept.length > 0 && <p className="text-xs text-amber">Would accept if: {vote.conditionsForAccept.join('; ')}</p>}
    </>
  );
}

export function ApprovalBody({ m }: { m: CouncilMessage }) {
  const data = d<{ version?: number; hash?: string; finalValidation?: ValidationReport; votes?: Vote[] }>(m);
  const sc = useScenario(m.scenarioId);
  const took = sc?.startedAt ? Date.parse(m.createdAt) - Date.parse(sc.startedAt) : null;
  const passed = data.finalValidation?.checks.filter((c) => c.status === 'PASS').length ?? 0;
  const applicable = data.finalValidation?.checks.filter((c) => c.status !== 'SKIP').length ?? 0;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-success/40 bg-success/5 p-3 shadow-[0_0_24px_-8px_var(--success)]">
      <div className="flex flex-wrap items-center gap-2">
        <Stamp className="size-5 text-success" aria-hidden />
        <span className="text-base font-semibold tracking-wide text-success">PLAN v{data.version} APPROVED</span>
        <span className="num text-xs text-muted-foreground">{hash8(data.hash)}</span>
        {took !== null && <Pill tone="success">in {mmss(took)}</Pill>}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Verdict status="PASS" label={<span className="num font-normal">{passed}/{applicable} checks</span>} />
        <Pill tone="success">
          <span className="num">{data.votes?.filter((v) => v.decision === 'ACCEPT').length ?? 0}/4</span> ACCEPT
        </Pill>
        {data.votes?.map((v) => (
          <span key={v.id} className="font-semibold" style={{ color: ACTOR_META[v.agentId].color }}>
            {ACTOR_META[v.agentId].callsign} ✓
          </span>
        ))}
      </div>
      <Text>{m.body}</Text>
    </div>
  );
}

export function DecisionBody({ m }: { m: CouncilMessage }) {
  const data = d<{ outcome?: string; certificate?: InfeasibilityCertificate | null; blockingReasons?: string[]; resolution?: string }>(m);
  const sc = useScenario(m.scenarioId);
  const tone = data.outcome === 'INFEASIBLE' ? 'danger' : data.outcome === 'INTERRUPTED' ? 'stale' : 'amber';
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={tone}>{data.outcome ?? m.subtype}</Pill>
      </div>
      <Text>{m.body}</Text>
      {data.blockingReasons && data.blockingReasons.length > 0 && (
        <ul className="list-inside list-disc text-xs text-muted-foreground">
          {data.blockingReasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      {data.resolution && (
        <p className="text-xs">
          <span className="font-medium text-muted-foreground">Resolution:</span> {data.resolution}
        </p>
      )}
      {data.outcome === 'INFEASIBLE' && data.certificate && <CertificateCard cert={data.certificate} sc={sc} compact />}
    </>
  );
}

export function EventBody({ m }: { m: CouncilMessage }) {
  const data = d<{ event?: EventRecord; requiresReplan?: boolean; notes?: string[] }>(m);
  const ev = data.event;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber/40 bg-amber/5 p-3">
      <div className="flex items-center gap-2">
        <Zap className="size-4 text-amber" aria-hidden />
        <span className="font-semibold text-amber">{ev?.interpretation.title ?? m.summary}</span>
        {ev && <Pill tone="muted">{ev.interpretation.source}</Pill>}
      </div>
      {ev?.interpretation.summary && <Text>{ev.interpretation.summary}</Text>}
      {ev?.interpretation.messageToCommander && <blockquote className="border-l-2 border-amber/60 pl-2 text-[13px] italic text-muted-foreground">“{ev.interpretation.messageToCommander}”</blockquote>}
      {ev && (
        <table className="num w-full max-w-md text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="text-left font-normal">Resource</th>
              <th className="text-right font-normal">Before</th>
              <th className="text-right font-normal">After</th>
              <th className="text-right font-normal">Δ</th>
            </tr>
          </thead>
          <tbody>
            {RESOURCE_KEYS.map((k) => {
              const delta = ev.poolAfter[k] - ev.poolBefore[k];
              return (
                <tr key={k} className={delta ? 'font-semibold' : 'text-muted-foreground'}>
                  <td>{RESOURCE_LABEL[k].name}</td>
                  <td className="text-right">{ev.poolBefore[k]}</td>
                  <td className="text-right">{ev.poolAfter[k]}</td>
                  <td className={cn('text-right', delta < 0 && 'text-danger', delta > 0 && 'text-success')}>{delta ? (delta > 0 ? `+${delta}` : delta) : '·'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {data.notes && data.notes.length > 0 && <p className="text-xs text-muted-foreground">{data.notes.join(' · ')}</p>}
      {data.requiresReplan === false && <p className="text-xs text-muted-foreground">requires_replan: false — the council still reconvenes for at least two visible rounds.</p>}
    </div>
  );
}

export function SystemBody({ m }: { m: CouncilMessage }) {
  const data = m.data as Data;
  if (m.subtype === 'COMMITMENT_REVIEW') {
    const items = (data.items as { id: string; from: string; to: string; reason: string }[] | undefined) ?? [];
    return (
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">{items.length} commitment(s) reviewed — show details</summary>
        <ul className="mt-1 flex flex-col gap-0.5">
          {items.map((i) => (
            <li key={i.id}>
              <span className="num font-semibold">{i.id}</span> {i.from} → <span className="font-semibold">{i.to}</span> — <span className="text-muted-foreground">{i.reason}</span>
            </li>
          ))}
        </ul>
      </details>
    );
  }
  if (m.body && m.body !== m.summary) return <Text className="text-xs text-muted-foreground">{m.body}</Text>;
  return null;
}

export function MessageBody({ m }: { m: CouncilMessage }) {
  switch (m.type) {
    case 'BRIEFING':
      return <BriefingBody m={m} />;
    case 'PROPOSAL':
      return <ProposalBody m={m} />;
    case 'OBJECTION':
      return <ObjectionBody m={m} />;
    case 'COUNTEROFFER':
      return <CounterofferBody m={m} />;
    case 'COMMITMENT':
      return <CommitmentBody m={m} />;
    case 'PLAN_DRAFT':
      return <PlanDraftBody m={m} />;
    case 'VALIDATION':
      return <ValidationBody m={m} />;
    case 'VOTE':
      return <VoteBody m={m} />;
    case 'APPROVAL':
      return <ApprovalBody m={m} />;
    case 'DECISION':
      return <DecisionBody m={m} />;
    case 'EVENT':
      return <EventBody m={m} />;
    case 'SYSTEM':
      return <SystemBody m={m} />;
  }
}


