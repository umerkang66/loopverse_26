'use client';

import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { RESOURCE_LABEL } from '@/domain/constants';
import { AGENT_IDS, type Commitment } from '@/domain/types';
import { useAres } from '@/client/store';
import { boardPlan, focusScenario, latestReport } from '@/client/selectors';
import { ACTOR_META } from '@/client/theme';
import { clock } from '@/client/format';
import { AgentEmblem, Empty, Pill, Tip } from '../bits';

const STATUS_TONE: Record<string, 'success' | 'amber' | 'danger' | 'info' | 'stale'> = {
  OFFERED: 'info',
  ACCEPTED: 'success',
  ACTIVE: 'success',
  FULFILLED: 'success',
  DUE: 'amber',
  BREACHED: 'danger',
  DECLINED: 'stale',
  WITHDRAWN: 'stale',
  VOID: 'stale',
  EXPIRED: 'stale',
};

export function LedgerPanel() {
  const state = useAres((s) => s.state);
  const focusId = useAres((s) => s.ui.focusScenarioId);
  const showInForce = useAres((s) => s.ui.showPlanInForce);
  const [scenario, setScenario] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [agent, setAgent] = useState('ALL');
  if (!state) return null;
  if (state.commitments.length === 0) return <Empty>No commitments yet. Departments offer returns to whoever takes a Sacrifice mode; the ledger tracks every promise across scenarios.</Empty>;
  const plan = boardPlan(state, focusScenario(state, focusId), showInForce);
  const affordability = latestReport(plan)?.checks.find((c) => c.id === 'COMMITMENT_AFFORDABILITY');
  const rows = state.commitments.filter(
    (c) => (scenario === 'ALL' || c.scenarioId === scenario) && (status === 'ALL' || c.status === status) && (agent === 'ALL' || c.owner === agent || c.beneficiary === agent),
  );
  const statuses = [...new Set(state.commitments.map((c) => c.status))];
  const select = (label: string, value: string, set: (v: string) => void, options: [string, string][]) => (
    <select aria-label={label} value={value} onChange={(e) => set(e.target.value)} className="h-7 rounded-md border bg-panel-2 px-2 text-xs">
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {select('Scenario', scenario, setScenario, [['ALL', 'All scenarios'], ...state.scenarios.map((s) => [s.id, s.id] as [string, string])])}
        {select('Status', status, setStatus, [['ALL', 'All statuses'], ...statuses.map((s) => [s, s] as [string, string])])}
        {select('Agent', agent, setAgent, [['ALL', 'All agents'], ...AGENT_IDS.map((a) => [a, ACTOR_META[a].callsign] as [string, string])])}
        <span className="num ml-auto self-center text-[11px] text-muted-foreground">{rows.length} shown</span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {rows.map((c) => (
          <LedgerRow key={c.id} c={c} inPlan={plan?.commitmentIds.includes(c.id) ?? false} planVersion={plan?.version ?? null} affordable={affordability ? !(affordability.status === 'FAIL' && affordability.reason.includes(c.id)) : null} />
        ))}
      </ul>
    </div>
  );
}

function LedgerRow({ c, inPlan, planVersion, affordable }: { c: Commitment; inPlan: boolean; planVersion: number | null; affordable: boolean | null }) {
  return (
    <li className="flex flex-col gap-1 rounded-md border bg-panel-2/60 px-2 py-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="num font-semibold">{c.id}</span>
        <AgentEmblem id={c.owner} size={16} />
        <span style={{ color: ACTOR_META[c.owner].color }}>{ACTOR_META[c.owner].callsign}</span>
        <ArrowRight className="size-3 text-muted-foreground" aria-hidden />
        <AgentEmblem id={c.beneficiary} size={16} />
        <span style={{ color: ACTOR_META[c.beneficiary].color }}>{ACTOR_META[c.beneficiary].callsign}</span>
        <Tip content={c.history.map((h) => `${clock(h.at)} ${h.status} by ${h.by}: ${h.reason}`).join('\n')}>
          <span>
            <Pill tone={STATUS_TONE[c.status] ?? 'stale'}>{c.status}</Pill>
          </span>
        </Tip>
        <span className="num text-muted-foreground">{c.scenarioId}</span>
        {inPlan && <Pill tone="mars">in v{planVersion}</Pill>}
        {inPlan && affordable !== null && <Pill tone={affordable ? 'success' : 'danger'}>{affordable ? 'affordable' : 'unaffordable'}</Pill>}
      </div>
      <span>“{c.promise}”</span>
      <span className="num text-[11px] text-muted-foreground">
        {c.kind}
        {c.resource ? ` · ${RESOURCE_LABEL[c.resource].name}` : ''}
        {c.amount ? ` ${c.amount}` : ''} · {c.expiry.label}
        {c.onlyIfSacrificeMode ? ` · if ${c.onlyIfSacrificeMode}` : ''} · history {c.history.map((h) => h.status).join(' → ')}
      </span>
    </li>
  );
}
