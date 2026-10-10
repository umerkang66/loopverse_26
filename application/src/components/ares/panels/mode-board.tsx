'use client';

import { RESOURCE_LABEL } from '@/domain/constants';
import { getMode, isModeId } from '@/domain/scenario';
import { DEPARTMENT_IDS, RESOURCE_KEYS, type Plan, type PublicState, type Scenario } from '@/domain/types';
import { useAres } from '@/client/store';
import { boardPlan, clearedVotes, deptView, focusDraft, focusScenario, planInForce, voteCounts, votesFor, type DeptView } from '@/client/selectors';
import { ACTOR_META, PLAN_STATUS_TONE } from '@/client/theme';
import { hash8 } from '@/client/format';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { AgentEmblem, Empty, Pill, StanceBadge, TierPill, VersionChip, VoteLight } from '../bits';

export function ModeBoard() {
  const state = useAres((s) => s.state);
  const messages = useAres((s) => s.messages);
  const focusId = useAres((s) => s.ui.focusScenarioId);
  const showInForce = useAres((s) => s.ui.showPlanInForce);
  const setUi = useAres((s) => s.setUi);
  if (!state) return null;
  const sc = focusScenario(state, focusId);
  const plan = boardPlan(state, sc, showInForce);
  const draft = focusDraft(state, sc);
  const inForce = planInForce(state);
  if (!plan) return <Empty>No plan drafted yet — the Commander drafts after the Round 1 positions.</Empty>;
  const votes = voteCounts(plan);
  const cleared = clearedVotes(state, plan);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5 rounded-lg border bg-panel-2 p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Plan</span>
          <VersionChip version={plan.version} hash={plan.hash} size="lg" />
          <Pill tone={PLAN_STATUS_TONE[plan.status]}>
            {plan.status}
            {(plan.status === 'VOTING' || votes.accept + votes.reject > 0) && <span className="num"> {votes.accept}/4</span>}
          </Pill>
          <span className="num text-xs text-muted-foreground">
            {plan.scenarioId} · R{plan.round} · risk {plan.risk}
          </span>
        </div>
        <p className="text-sm font-medium">{plan.label}</p>
        {plan.statusReason && <p className="text-xs text-muted-foreground">{plan.statusReason}</p>}
        {inForce && draft && inForce.version !== draft.version && (
          <div className="flex items-center gap-2 pt-1">
            <Switch id="show-in-force" checked={showInForce} onCheckedChange={(v) => setUi({ showPlanInForce: v })} />
            <Label htmlFor="show-in-force" className="text-xs">
              Show plan in force (v{inForce.version} · {inForce.status})
            </Label>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2">
        {DEPARTMENT_IDS.map((d) => (
          <DepartmentCard key={d} view={deptView(state, plan, sc, d, messages)} plan={plan} sc={sc} />
        ))}
      </div>
      <VotePanel state={state} plan={plan} cleared={cleared} />
    </div>
  );
}

function DepartmentCard({ view, plan, sc }: { view: DeptView; plan: Plan; sc: Scenario | null }) {
  const setUi = useAres((s) => s.setUi);
  const meta = ACTOR_META[view.dept];
  const mode = view.selectedMode && isModeId(view.selectedMode) ? getMode(view.selectedMode) : null;
  const sacrificing = plan.sacrifices.includes(view.dept);
  const required = plan.policy.requiredReturnCommitments;
  const pool = sc?.pool ?? plan.poolSnapshot;
  return (
    <button
      type="button"
      onClick={() => setUi({ selectedAgent: view.dept })}
      className="flex flex-col gap-1.5 rounded-lg border bg-panel p-2.5 text-left hover:bg-panel-2"
      style={{ borderLeft: `3px solid ${meta.color}` }}
      aria-label={`${meta.callsign} department card. Open agent mind`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <AgentEmblem id={view.dept} size={22} />
        <span className="font-semibold" style={{ color: meta.color }}>
          {meta.callsign}
        </span>
        <span className="text-xs text-muted-foreground">{meta.dept}</span>
        <span className="ml-auto flex items-center gap-1.5">
          <TierPill modeId={view.selectedMode} withRisk />
          <VoteLight vote={view.vote} label={meta.callsign} />
        </span>
      </div>
      {mode && (
        <div className="grid grid-cols-5 gap-1.5">
          {RESOURCE_KEYS.map((k) => (
            <div key={k} className="flex flex-col gap-0.5">
              <span className="num text-[10px] text-muted-foreground">
                {RESOURCE_LABEL[k].short}
                {mode.resources[k]}
              </span>
              <div className="h-1 rounded-full bg-panel-2">
                <div className="h-1 rounded-full" style={{ width: `${Math.min(100, (mode.resources[k] / Math.max(1, pool[k])) * 100)}%`, backgroundColor: meta.color }} />
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {view.requestedMode && view.requestedMode !== view.selectedMode && (
          <Pill tone="amber">
            Requested: <span className="num">{view.requestedMode}</span>
          </Pill>
        )}
        <StanceBadge stance={view.stance?.sacrifice} conditions={view.stance?.conditions} />
      </div>
      {mode && <p className={`text-xs ${mode.tier === 'SACRIFICE' ? 'text-danger' : 'text-muted-foreground'}`}>{mode.consequence}</p>}
      {sacrificing && (
        <div className="flex flex-col gap-0.5 rounded-md border border-border bg-panel-2 px-2 py-1">
          <span className="text-xs">
            Return commitments{' '}
            <span className={`num font-semibold ${view.acceptedReturnOwners >= required ? 'text-success' : 'text-danger'}`}>
              {view.acceptedReturnOwners}/{required} {view.acceptedReturnOwners >= required ? '✓' : '✗'}
            </span>
          </span>
          {view.returns.map((c) => (
            <span key={c.id} className="text-[11px] text-muted-foreground">
              <span className="num text-foreground">{c.id}</span> · {ACTOR_META[c.owner].callsign}: {c.promise} · {c.expiry.label} · <span className="text-foreground">{c.status}</span>
            </span>
          ))}
        </div>
      )}
      <div className="text-xs">
        {view.conflicts.length === 0 ? (
          <span className="text-muted-foreground">No conflicts</span>
        ) : (
          <ul className="flex flex-col gap-0.5 text-danger">
            {view.conflicts.map((c, i) => (
              <li key={i}>• {c}</li>
            ))}
          </ul>
        )}
      </div>
    </button>
  );
}

function VotePanel({ state, plan, cleared }: { state: PublicState; plan: Plan; cleared: { fromVersion: number; count: number } | null }) {
  const votes = votesFor(plan);
  const counts = voteCounts(plan);
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border bg-panel-2 p-2.5">
      <div className="flex items-center justify-between">
        <span className="panel-title">Votes on v{plan.version}</span>
        <span className="num text-xs text-muted-foreground">
          {counts.accept} accept · {counts.reject} reject · {counts.pending} pending · {hash8(plan.hash)}
        </span>
      </div>
      <div className="flex flex-wrap gap-3">
        {DEPARTMENT_IDS.map((d) => (
          <span key={d} className="flex items-center gap-1.5 text-xs">
            <VoteLight vote={votes[d]} label={ACTOR_META[d].callsign} />
            <span style={{ color: ACTOR_META[d].color }}>{ACTOR_META[d].callsign}</span>
          </span>
        ))}
      </div>
      {cleared && (
        <p className="text-xs text-muted-foreground">
          Votes cleared at v{cleared.fromVersion} → v{plan.version} ({cleared.count} vote{cleared.count === 1 ? '' : 's'}) — any plan change requires fresh ballots.
        </p>
      )}
      {state.scenarios.find((s) => s.id === plan.scenarioId)?.minRoundsBeforeApproval && plan.round < (state.scenarios.find((s) => s.id === plan.scenarioId)?.minRoundsBeforeApproval ?? 0) && counts.accept + counts.reject === 0 && (
        <p className="text-xs text-muted-foreground">Voting opens in round {state.scenarios.find((s) => s.id === plan.scenarioId)?.minRoundsBeforeApproval} (protocol).</p>
      )}
    </div>
  );
}
