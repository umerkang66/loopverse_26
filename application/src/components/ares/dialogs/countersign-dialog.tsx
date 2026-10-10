'use client';

import { useMemo, useState } from 'react';
import { PenLine, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { DEPARTMENT_LABEL } from '@/domain/constants';
import { getMode } from '@/domain/scenario';
import { DEPARTMENT_IDS } from '@/domain/types';
import { api } from '@/client/api';
import { currentScenario, planByVersion, votesFor } from '@/client/selectors';
import { useAres } from '@/client/store';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Pill } from '../bits';

/**
 * Human-in-the-loop (bonus): a plan whose risk exceeds the threshold waits for Mission Control.
 * Opens automatically when the run enters AWAITING_COUNTERSIGN; "Later" keeps the pulsing header status.
 */
export function CountersignDialog() {
  const state = useAres((s) => s.state);
  const open = useAres((s) => s.ui.dialogs.countersign);
  const openDialog = useAres((s) => s.openDialog);
  const sc = state ? currentScenario(state) : null;
  const awaiting = state?.run.status === 'AWAITING_COUNTERSIGN' && sc?.status === 'AWAITING_COUNTERSIGN';
  const key = awaiting ? `${sc!.id}:${sc!.approvedPlanVersion}` : null;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [vetoing, setVetoing] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const plan = useMemo(() => (state && sc ? planByVersion(state, sc.approvedPlanVersion) : null), [state, sc]);
  if (!state || !awaiting || !plan || !sc) return null;
  const show = open || dismissed !== key;
  const report = [...plan.validations].reverse().find((r) => r.stage === 'APPROVAL') ?? plan.validations[plan.validations.length - 1];
  const votes = votesFor(plan);
  const threshold = state.config.hitl.riskThreshold;

  const decide = async (decision: 'COUNTERSIGN' | 'VETO') => {
    setBusy(true);
    try {
      await api.countersign(decision, reason.trim());
      toast.success(decision === 'COUNTERSIGN' ? `Plan v${plan.version} countersigned by Mission Control` : `Plan v${plan.version} vetoed: the council renegotiates`);
      setReason('');
      setVetoing(false);
      openDialog('countersign', false);
    } catch {
      // toast shown by the client
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={show}
      onOpenChange={(o) => {
        openDialog('countersign', o);
        if (!o) setDismissed(key);
      }}
    >
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber">
            <ShieldAlert className="size-4 animate-pulse" /> Human countersign required — plan v{plan.version} · risk {plan.risk} &gt; {threshold}
          </DialogTitle>
          <DialogDescription>
            The council reached a valid, unanimous plan in {sc.id} round {sc.round}. Because the combined risk exceeds {threshold}, Mission Control must countersign or veto it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 text-sm">
          <ul className="grid gap-1.5">
            {DEPARTMENT_IDS.map((d) => {
              const mode = getMode(plan.selections[d]);
              const v = votes[d];
              return (
                <li key={d} className="flex items-center justify-between gap-3 rounded-md border bg-panel-2 px-2.5 py-1.5">
                  <span>
                    <b>{DEPARTMENT_LABEL[d]}</b> · {mode.id} {mode.label}
                    {plan.sacrifices.includes(d) && <span className="text-danger"> · SACRIFICE</span>}
                  </span>
                  <Pill tone={v?.decision === 'ACCEPT' ? 'success' : v ? 'danger' : 'muted'}>{v?.decision ?? 'no vote'}</Pill>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Pill tone={report?.status === 'PASS' ? 'success' : 'danger'}>Validator {report?.status ?? '—'}</Pill>
            <span className="text-muted-foreground">{report?.checks.filter((c) => c.status === 'PASS').length}/{report?.checks.filter((c) => c.status !== 'SKIP').length} checks passed at approval</span>
            <Pill tone="amber">risk {plan.risk}</Pill>
            {plan.commitmentIds.length > 0 && <Pill tone="info">{plan.commitmentIds.length} return commitment(s)</Pill>}
          </div>
          <p className="text-xs text-muted-foreground">{plan.rationale}</p>
          {vetoing && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="veto-reason" className="text-xs font-medium">
                Reason for the veto (required — every agent receives it in the next round)
              </label>
              <Textarea id="veto-reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} placeholder="e.g. Engineering's crew cannot absorb another Sacrifice this cycle." />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => openDialog('countersign', false)}>
            Decide later
          </Button>
          <div className="flex gap-2">
            {vetoing ? (
              <>
                <Button variant="ghost" onClick={() => setVetoing(false)} disabled={busy}>
                  Back
                </Button>
                <Button variant="destructive" disabled={busy || !reason.trim()} onClick={() => void decide('VETO')}>
                  Confirm veto
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setVetoing(true)} disabled={busy}>
                  Veto…
                </Button>
                <Button onClick={() => void decide('COUNTERSIGN')} disabled={busy}>
                  <PenLine /> Countersign
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
