'use client';

import { GitCompareArrows } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RESOURCE_LABEL } from '@/domain/constants';
import { DEPARTMENT_IDS, RESOURCE_KEYS, type Plan, type PublicState } from '@/domain/types';
import { capOf } from '@/engine/resources';
import { useAres } from '@/client/store';
import { latestReport, planByVersion, voteCounts } from '@/client/selectors';
import { ACTOR_META, PLAN_STATUS_TONE } from '@/client/theme';
import { clock, hash8 } from '@/client/format';
import { Button } from '@/components/ui/button';
import { Empty, ModeChips, Pill, TierPill, VecVs, Verdict, VersionChip } from '../bits';
import { CommitmentLine } from '../transcript/bodies';

export function HistoryPanel() {
  const state = useAres((s) => s.state);
  const selected = useAres((s) => s.ui.selectedPlanVersion);
  const compare = useAres((s) => s.ui.compare);
  const setUi = useAres((s) => s.setUi);
  if (!state) return null;
  if (state.plans.length === 0) return <Empty>No plan versions yet. Every draft gets a version (v1, v2, …) and a content hash; votes bind to both.</Empty>;
  const comparing = compare[0] !== null || compare[1] !== null;
  const plan = planByVersion(state, selected) ?? state.plans[state.plans.length - 1]!;
  const byScenario = [...state.scenarios].reverse().map((sc) => ({ sc, plans: state.plans.filter((p) => p.scenarioId === sc.id).reverse() }));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{state.plans.length} versions · newest first</span>
        <Button size="sm" variant={comparing ? 'secondary' : 'outline'} onClick={() => setUi({ compare: comparing ? [null, null] : [Math.max(1, plan.version - 1), plan.version] })}>
          <GitCompareArrows /> {comparing ? 'Close compare' : 'Compare'}
        </Button>
      </div>
      {comparing && <Compare state={state} />}
      <ol className="flex flex-col gap-2">
        {byScenario.map(({ sc, plans }) =>
          plans.length === 0 ? null : (
            <li key={sc.id} className="flex flex-col gap-1.5">
              <span className="panel-title">
                {sc.id} · {sc.kind === 'BASELINE' ? 'Baseline' : sc.title}
              </span>
              {plans.map((p) => (
                <VersionRow key={p.version} state={state} plan={p} active={p.version === plan.version} onSelect={() => setUi({ selectedPlanVersion: p.version })} />
              ))}
            </li>
          ),
        )}
      </ol>
      <VersionDetail state={state} plan={plan} />
    </div>
  );
}

function VersionRow({ state, plan, active, onSelect }: { state: PublicState; plan: Plan; active: boolean; onSelect: () => void }) {
  const sc = state.scenarios.find((s) => s.id === plan.scenarioId);
  const cap = sc ? capOf(sc.pool, sc.reserveRequirements) : undefined;
  const report = latestReport(plan);
  const votes = voteCounts(plan);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn('flex flex-col gap-1 rounded-lg border p-2 text-left', active ? 'border-mars/60 bg-mars/5' : 'border-border bg-panel hover:bg-panel-2')}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <VersionChip version={plan.version} hash={plan.hash} />
        <Pill tone={PLAN_STATUS_TONE[plan.status]}>{plan.status}</Pill>
        <span className="num text-[11px] text-muted-foreground">R{plan.round}</span>
        <span className="truncate text-xs">{plan.label}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ModeChips selections={plan.selections} />
        <span className="num text-[11px] text-muted-foreground">risk {plan.risk}</span>
        {report && <Verdict status={report.status} label={<span className="font-normal opacity-80">{report.stage}</span>} />}
        <span className="num text-[11px] text-muted-foreground">
          votes {votes.accept}✓ {votes.reject}✗
        </span>
      </div>
      <VecVs totals={plan.totals} cap={cap} className="text-[11px]" />
    </button>
  );
}

function VersionDetail({ state, plan }: { state: PublicState; plan: Plan }) {
  const highlight = useAres((s) => s.highlight);
  const superseded = plan.status === 'SUPERSEDED' || plan.status === 'STALE' || plan.status === 'INVALID';
  const commitments = state.commitments.filter((c) => plan.commitmentIds.includes(c.id));
  return (
    <section className="flex flex-col gap-2 rounded-lg border bg-panel-2 p-3" aria-label={`Plan v${plan.version} detail`}>
      <div className="flex flex-wrap items-center gap-2">
        <VersionChip version={plan.version} hash={plan.hash} size="lg" />
        <Pill tone={PLAN_STATUS_TONE[plan.status]}>{plan.status}</Pill>
        <span className="text-sm font-medium">{plan.label}</span>
      </div>
      {plan.statusReason && <p className="text-xs text-muted-foreground">{plan.statusReason}</p>}
      <p className="text-[13px] whitespace-pre-wrap text-muted-foreground">{plan.rationale}</p>
      {plan.diff ? (
        <div className="flex flex-col gap-1 rounded-md border border-info/30 bg-info/5 p-2 text-xs">
          <span className="font-semibold text-info">What changed vs v{plan.diff.fromVersion}</span>
          {plan.diff.modeChanges.map((c) => (
            <span key={c.department} className="num">
              {ACTOR_META[c.department].callsign}: {c.from} → {c.to} ·{' '}
              {RESOURCE_KEYS.filter((k) => c.delta[k] !== 0)
                .map((k) => `${RESOURCE_LABEL[k].short}${c.delta[k] > 0 ? '+' : ''}${c.delta[k]}`)
                .join(' ')}{' '}
              · risk {c.riskDelta > 0 ? '+' : ''}
              {c.riskDelta}
            </span>
          ))}
          {plan.diff.commitmentsAdded.length > 0 && <span className="text-success">+ {plan.diff.commitmentsAdded.join(', ')}</span>}
          {plan.diff.commitmentsRemoved.length > 0 && <span className="text-danger">− {plan.diff.commitmentsRemoved.join(', ')}</span>}
          {plan.diff.policyChanged && <span className="text-amber">Policy changed (Crisis Override)</span>}
          <span className="text-muted-foreground">{plan.diff.summary}</span>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">First version in {plan.scenarioId}.</p>
      )}
      <div className="flex flex-col gap-1">
        <span className="panel-title">Validation reports</span>
        {plan.validations.length === 0 && <span className="text-xs text-muted-foreground">Not validated yet.</span>}
        {plan.validations.map((r, i) => (
          <span key={i} className="flex flex-wrap items-center gap-2 text-xs">
            <Verdict status={r.status} />
            <span className="num text-muted-foreground">
              {r.stage} · {clock(r.evaluatedAt)}
            </span>
            {r.status === 'FAIL' && <span className="text-danger">{r.checks.filter((c) => c.status === 'FAIL').map((c) => c.id).join(', ')}</span>}
          </span>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        <span className="panel-title">Ballots</span>
        {plan.votes.length === 0 && <span className="text-xs text-muted-foreground">No ballots on this version.</span>}
        {plan.votes.map((v) => (
          <span key={v.id} className={cn('flex flex-wrap items-center gap-1.5 text-xs', superseded && 'opacity-50')}>
            <span className="font-semibold" style={{ color: ACTOR_META[v.agentId].color }}>
              {ACTOR_META[v.agentId].callsign}
            </span>
            <Pill tone={v.decision === 'ACCEPT' ? 'success' : 'danger'}>{v.decision}</Pill>
            <span className="num text-muted-foreground">
              v{v.planVersion} {hash8(v.planHash)} · R{v.round}
            </span>
            {superseded && <span className="text-muted-foreground">(superseded)</span>}
            <span className="w-full text-muted-foreground">{v.reason}</span>
          </span>
        ))}
      </div>
      {commitments.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="panel-title">Included commitments</span>
          {commitments.map((c) => (
            <div key={c.id} className="flex flex-col">
              <CommitmentLine c={c} />
              <span className="pl-1 text-xs text-muted-foreground">“{c.promise}” · {c.expiry.label}</span>
            </div>
          ))}
        </div>
      )}
      {plan.respondsTo.length > 0 && (
        <p className="flex flex-wrap gap-1 text-xs text-muted-foreground">
          Responds to:
          {plan.respondsTo.map((id) => (
            <button key={id} type="button" onClick={() => highlight(id)} className="num text-info hover:underline">
              {id}
            </button>
          ))}
        </p>
      )}
    </section>
  );
}

function Compare({ state }: { state: PublicState }) {
  const compare = useAres((s) => s.ui.compare);
  const setUi = useAres((s) => s.setUi);
  const a = planByVersion(state, compare[0]);
  const b = planByVersion(state, compare[1]);
  const select = (i: 0 | 1, v: number) => setUi({ compare: i === 0 ? [v, compare[1]] : [compare[0], v] });
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-info/40 bg-info/5 p-2.5">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Compare</span>
        {[0, 1].map((i) => (
          <select
            key={i}
            aria-label={i === 0 ? 'First version' : 'Second version'}
            value={compare[i as 0 | 1] ?? ''}
            onChange={(e) => select(i as 0 | 1, Number(e.target.value))}
            className="h-7 rounded-md border bg-panel-2 px-2"
          >
            {state.plans.map((p) => (
              <option key={p.version} value={p.version}>
                v{p.version} · {p.scenarioId} · {p.status}
              </option>
            ))}
          </select>
        ))}
      </div>
      {a && b && (
        <table className="num w-full text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="text-left font-normal" />
              <th className="text-left font-normal">v{a.version}</th>
              <th className="text-left font-normal">v{b.version}</th>
              <th className="text-right font-normal">Δ</th>
            </tr>
          </thead>
          <tbody>
            {DEPARTMENT_IDS.map((d) => (
              <tr key={d} className={a.selections[d] !== b.selections[d] ? 'bg-amber/10' : undefined}>
                <td className="pr-2" style={{ color: ACTOR_META[d].color }}>
                  {ACTOR_META[d].callsign}
                </td>
                <td>
                  <TierPill modeId={a.selections[d]} />
                </td>
                <td>
                  <TierPill modeId={b.selections[d]} />
                </td>
                <td className="text-right">{a.selections[d] !== b.selections[d] ? 'changed' : ''}</td>
              </tr>
            ))}
            {RESOURCE_KEYS.map((k) => {
              const delta = b.totals[k] - a.totals[k];
              return (
                <tr key={k}>
                  <td className="pr-2 text-muted-foreground">{RESOURCE_LABEL[k].name}</td>
                  <td>{a.totals[k]}</td>
                  <td>{b.totals[k]}</td>
                  <td className={cn('text-right', delta > 0 && 'text-danger', delta < 0 && 'text-success')}>{delta ? (delta > 0 ? `+${delta}` : delta) : '·'}</td>
                </tr>
              );
            })}
            <tr>
              <td className="pr-2 text-muted-foreground">Risk</td>
              <td>{a.risk}</td>
              <td>{b.risk}</td>
              <td className="text-right">{b.risk - a.risk || '·'}</td>
            </tr>
            <tr>
              <td className="pr-2 text-muted-foreground">Sacrifices</td>
              <td>{a.sacrifices.map((d) => ACTOR_META[d].callsign).join(', ') || '—'}</td>
              <td>{b.sacrifices.map((d) => ACTOR_META[d].callsign).join(', ') || '—'}</td>
              <td />
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
