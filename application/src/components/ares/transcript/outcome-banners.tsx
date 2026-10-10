'use client';

import { motion, useReducedMotion } from 'motion/react';
import { AlertOctagon, CheckCircle2, PauseCircle, ShieldX, StepForward } from 'lucide-react';
import { RESOURCE_KEYS } from '@/domain/types';
import { useAres } from '@/client/store';
import { focusScenario, latestReport, planByVersion, voteCounts } from '@/client/selectors';
import { mmss } from '@/client/format';
import { Button } from '@/components/ui/button';
import { resumeCouncil, ExportMenu } from '../judge-controls';

export function OutcomeBanners() {
  const state = useAres((s) => s.state);
  const readOnly = useAres((s) => s.readOnly);
  const focusId = useAres((s) => s.ui.focusScenarioId);
  const setUi = useAres((s) => s.setUi);
  const openDialog = useAres((s) => s.openDialog);
  const reduce = useReducedMotion();
  if (!state) return null;
  const sc = focusScenario(state, focusId);
  if (!sc) return null;
  const isLatest = state.scenarios[state.scenarios.length - 1]?.id === sc.id;
  const took = sc.startedAt && sc.resolvedAt ? mmss(Date.parse(sc.resolvedAt) - Date.parse(sc.startedAt)) : null;

  const stale = sc.previousPlan && sc.status !== 'RESOLVED' && (
    <div className={`rounded-md border px-3 py-1.5 text-xs ${sc.previousPlan.status === 'INVALID' ? 'border-danger/40 bg-danger/10 text-danger' : 'border-amber/40 bg-amber/10 text-amber'}`} role="status">
      Plan v{sc.previousPlan.version} {sc.previousPlan.status} — {sc.previousPlan.reasons.join('; ')}. Renegotiating…
    </div>
  );

  if (sc.outcome === 'APPROVED') {
    const plan = planByVersion(state, sc.approvedPlanVersion);
    const report = latestReport(plan);
    const passed = report?.checks.filter((c) => c.status === 'PASS').length ?? 0;
    const applicable = report?.checks.filter((c) => c.status !== 'SKIP').length ?? 0;
    return (
      <motion.div
        initial={reduce ? false : { scale: 0.97, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="flex flex-wrap items-center gap-3 rounded-[10px] border border-success/50 bg-success/10 px-3 py-2 shadow-[0_0_28px_-10px_var(--success)]"
        role="status"
      >
        <CheckCircle2 className="size-5 text-success" aria-hidden />
        <span className="font-semibold tracking-wide text-success">ACCORD REACHED</span>
        <span className="num text-sm">
          {sc.id} · Plan v{sc.approvedPlanVersion} · round {sc.round} · {voteCounts(plan).accept}/4 ACCEPT · Validator PASS {passed}/{applicable}
          {took ? ` · ${took}` : ''}
        </span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setUi({ rightTab: 'board', showPlanInForce: false, focusScenarioId: sc.id === state.scenarios.at(-1)?.id ? null : sc.id })}>
            View plan
          </Button>
          <ExportMenu className="h-7" sessionId={readOnly ? state.id : null} />
        </div>
      </motion.div>
    );
  }

  if (sc.outcome === 'INFEASIBLE' && sc.certificate) {
    const cert = sc.certificate;
    const closest = cert.closest[0];
    const simulateResupply = () => {
      if (!closest) return;
      const deltas = Object.fromEntries(RESOURCE_KEYS.filter((k) => closest.shortfall[k] > 0).map((k) => [k, closest.shortfall[k]]));
      setUi({ injectPreset: { tab: 'manual', manualDeltas: deltas, title: 'Emergency resupply' } });
      openDialog('inject');
    };
    return (
      <motion.div initial={reduce ? false : { y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="flex flex-col gap-1.5 rounded-[10px] border border-danger/50 bg-danger/10 px-3 py-2" role="status">
        <div className="flex flex-wrap items-center gap-2">
          <ShieldX className="size-5 text-danger" aria-hidden />
          <span className="font-semibold tracking-wide text-danger">INFEASIBLE</span>
          <span className="text-sm">— proven by exhaustive search of {cert.combinationsChecked} combinations</span>
          {took && <span className="num text-xs text-muted-foreground">· {took}</span>}
        </div>
        {cert.blocking[0] && <p className="text-sm">{cert.blocking[0].detail}</p>}
        {cert.requests[0] && <p className="text-sm font-semibold text-amber">{cert.requests[0]}</p>}
        <div className="flex flex-wrap gap-2">
          {!readOnly && isLatest && closest && (
            <Button size="sm" onClick={simulateResupply}>
              Simulate resupply
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setUi({ rightTab: 'feasibility' })}>
            View certificate
          </Button>
        </div>
      </motion.div>
    );
  }

  if (sc.outcome === 'DEADLOCK' || sc.outcome === 'TIMEOUT' || sc.outcome === 'INTERRUPTED') {
    const decision = [...state.plans].reverse().find((p) => p.scenarioId === sc.id);
    const Icon = sc.outcome === 'INTERRUPTED' ? PauseCircle : AlertOctagon;
    return (
      <motion.div initial={reduce ? false : { y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="flex flex-wrap items-center gap-2 rounded-[10px] border border-amber/50 bg-amber/10 px-3 py-2" role="status">
        <Icon className="size-5 text-amber" aria-hidden />
        <span className="font-semibold tracking-wide text-amber">{sc.outcome}</span>
        <span className="text-sm">{sc.outcomeReason}</span>
        {decision && decision.status === 'REJECTED' && decision.statusReason && <span className="text-xs text-muted-foreground">· {decision.statusReason}</span>}
        {!readOnly && isLatest && (
          <Button size="sm" className="ml-auto" onClick={() => void resumeCouncil()}>
            <StepForward /> Resume (+2 rounds)
          </Button>
        )}
      </motion.div>
    );
  }
  return stale || null;
}
