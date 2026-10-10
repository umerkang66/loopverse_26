'use client';

import { useState } from 'react';
import { Check, Minus, ShieldCheck, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RESOURCE_LABEL } from '@/domain/constants';
import { RESOURCE_KEYS, type ResourceVector, type ValidationCheck } from '@/domain/types';
import { useAres } from '@/client/store';
import { boardPlan, focusScenario } from '@/client/selectors';
import { clock, hash8 } from '@/client/format';
import { Empty, Verdict, VersionChip } from '../bits';

export function ValidationPanel() {
  const state = useAres((s) => s.state);
  const focusId = useAres((s) => s.ui.focusScenarioId);
  const showInForce = useAres((s) => s.ui.showPlanInForce);
  const [pick, setPick] = useState<{ version: number; index: number } | null>(null);
  if (!state) return null;
  const sc = focusScenario(state, focusId);
  const plan = boardPlan(state, sc, showInForce);
  if (!plan || plan.validations.length === 0) return <Empty>No validation yet — every plan draft is checked by the deterministic validator before any vote.</Empty>;
  const index = pick && pick.version === plan.version ? Math.min(pick.index, plan.validations.length - 1) : plan.validations.length - 1;
  const report = plan.validations[index]!;
  return (
    <div className="flex flex-col gap-3">
      <div className={cn('flex flex-col gap-2 rounded-lg border p-3', report.status === 'PASS' ? 'border-success/40 bg-success/5' : 'border-danger/40 bg-danger/5')}>
        <div className="flex flex-wrap items-center gap-3">
          <Verdict status={report.status} size="lg" />
          <div className="flex flex-col text-xs">
            <span className="num font-semibold">{report.stage}</span>
            <span className="num text-muted-foreground">
              {clock(report.evaluatedAt)} · risk {report.risk}
            </span>
          </div>
          <span className="ml-auto flex items-center gap-1">
            <VersionChip version={report.planVersion} hash={report.planHash} />
          </span>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" aria-hidden /> Deterministic validator — pure TypeScript, no LLM involved. Approval re-runs it; nothing bypasses it.
        </p>
      </div>
      {plan.validations.length > 1 && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Report history for v{plan.version}
          <select
            className="h-7 rounded-md border bg-panel-2 px-2 text-xs text-foreground"
            value={index}
            onChange={(e) => setPick({ version: plan.version, index: Number(e.target.value) })}
          >
            {plan.validations.map((r, i) => (
              <option key={i} value={i}>
                #{i + 1} {r.stage} · {r.status} · {clock(r.evaluatedAt)}
              </option>
            ))}
          </select>
        </label>
      )}
      <ol className="flex flex-col gap-1">
        {report.checks.map((c, i) => (
          <CheckRow key={c.id} check={c} n={i + 1} />
        ))}
      </ol>
      {report.warnings.length > 0 && (
        <ul className="flex flex-col gap-0.5 rounded-md border border-amber/40 bg-amber/5 p-2 text-xs text-amber">
          {report.warnings.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      )}
      <p className="num text-[11px] text-muted-foreground">
        Plan hash {hash8(report.planHash)} · {report.checks.filter((c) => c.status === 'PASS').length} pass · {report.checks.filter((c) => c.status === 'FAIL').length} fail ·{' '}
        {report.checks.filter((c) => c.status === 'SKIP').length} not applicable
      </p>
    </div>
  );
}

function CheckRow({ check, n }: { check: ValidationCheck; n: number }) {
  const Icon = check.status === 'PASS' ? Check : check.status === 'FAIL' ? X : Minus;
  const details = check.details as { totals?: ResourceVector; cap?: ResourceVector } | undefined;
  return (
    <li className={cn('rounded-md border px-2 py-1.5 text-xs', check.status === 'FAIL' ? 'border-danger/40 bg-danger/5' : 'border-border bg-panel-2/60')}>
      <details open={check.status === 'FAIL'}>
        <summary className="flex cursor-pointer list-none items-start gap-2">
          <span className="num w-4 text-muted-foreground">{n}</span>
          <Icon className={cn('mt-0.5 size-3.5 shrink-0', check.status === 'PASS' ? 'text-success' : check.status === 'FAIL' ? 'text-danger' : 'text-muted-foreground')} aria-hidden />
          <span className="flex-1">
            <span className="font-semibold">{check.label}</span>{' '}
            <span className={cn('text-[10px] font-semibold', check.status === 'PASS' ? 'text-success' : check.status === 'FAIL' ? 'text-danger' : 'text-muted-foreground')}>{check.status}</span>
            <span className="block text-muted-foreground">{check.reason}</span>
          </span>
        </summary>
        {details?.totals && details.cap && (
          <table className="num mt-1.5 ml-6 text-[11px]">
            <thead>
              <tr className="text-muted-foreground">
                <th className="pr-3 text-left font-normal">Resource</th>
                <th className="pr-3 text-right font-normal">Demand</th>
                <th className="pr-3 text-right font-normal">Cap</th>
                <th className="text-right font-normal">Over</th>
              </tr>
            </thead>
            <tbody>
              {RESOURCE_KEYS.map((k) => {
                const over = details.totals![k] - details.cap![k];
                return (
                  <tr key={k} className={over > 0 ? 'text-danger' : undefined}>
                    <td className="pr-3">{RESOURCE_LABEL[k].name}</td>
                    <td className="pr-3 text-right">{details.totals![k]}</td>
                    <td className="pr-3 text-right">{details.cap![k]}</td>
                    <td className="text-right">{over > 0 ? `+${over}` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </details>
    </li>
  );
}
