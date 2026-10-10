'use client';

import { useState } from 'react';
import { KeyRound, Play, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { api, getJudgeCode, setJudgeCode } from '@/client/api';
import { useAres } from '@/client/store';
import { PROTOCOL_STEPS } from '@/client/selectors';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Pill } from '../bits';
import { ResourceEditor } from '../resource-editor';

export function StartDialog() {
  const open = useAres((s) => s.ui.dialogs.start);
  const openDialog = useAres((s) => s.openDialog);
  return (
    <Dialog open={open} onOpenChange={(o) => openDialog('start', o)}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="size-4 text-mars" /> Start the crisis
          </DialogTitle>
          <DialogDescription>Enter the available resources. The Commander receives them first, publishes them to the council, and opens Round 1.</DialogDescription>
        </DialogHeader>
        {open && <ResourceEditor autoFocus onStarted={() => openDialog('start', false)} />}
      </DialogContent>
    </Dialog>
  );
}

export function ResetDialog() {
  const open = useAres((s) => s.ui.dialogs.reset);
  const openDialog = useAres((s) => s.openDialog);
  const [busy, setBusy] = useState(false);
  const reset = async () => {
    setBusy(true);
    try {
      await api.reset();
      toast.success('Session archived — a fresh council is standing by');
      openDialog('reset', false);
    } catch {
      // toast shown
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => openDialog('reset', o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="size-4" /> Reset the council?
          </DialogTitle>
          <DialogDescription>Archives this session (history stays in the Session Archive) and starts a fresh council. Nothing is deleted.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => openDialog('reset', false)}>
            Cancel
          </Button>
          <Button onClick={() => void reset()} disabled={busy}>
            {busy ? 'Archiving…' : 'Archive & reset'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function JudgeCodeDialog() {
  const open = useAres((s) => s.ui.dialogs.judgeCode);
  const openDialog = useAres((s) => s.openDialog);
  const [code, setCode] = useState(() => (typeof window === 'undefined' ? '' : getJudgeCode()));
  return (
    <Dialog open={open} onOpenChange={(o) => openDialog('judgeCode', o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4" /> Judge access code
          </DialogTitle>
          <DialogDescription>This deployment protects its controls. Enter the access code you were given; it is stored only in this browser.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setJudgeCode(code.trim());
            openDialog('judgeCode', false);
            toast.success('Access code saved — repeat your action');
          }}
        >
          <Input type="password" value={code} onChange={(e) => setCode(e.target.value)} autoFocus aria-label="Access code" />
          <DialogFooter>
            <Button type="submit" disabled={!code.trim()}>
              Save code
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const PANELS: [string, string][] = [
  ['Mission Control', 'Current event, available vs used resources (department-colored), reserve, risk, sacrifice slots, the 7-step protocol, and rounds.'],
  ['Council Transcript', 'Every proposal, objection, counteroffer, commitment, vote, and decision — agent, type, round, and plan version on every message.'],
  ['Mode Board', "Each department's selected package, consequence, risk, return commitments, conflicts, stance, and vote."],
  ['Validation', 'The deterministic validator verdict: PASS or FAIL with the specific reason for each check. No LLM involved.'],
  ['Judge Controls', 'Start with your resources, inject events, resume, reset (archived), and export everything.'],
  ['History · Feasibility · Compliance · Ledger', 'Plan diffs, the 81-combination optimizer map with infeasibility proofs, the live requirement checklist, and every promise.'],
];

export function HelpDialog() {
  const open = useAres((s) => s.ui.dialogs.help);
  const openDialog = useAres((s) => s.openDialog);
  return (
    <Dialog open={open} onOpenChange={(o) => openDialog('help', o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle>How to read this dashboard</DialogTitle>
          <DialogDescription>How to test: Start → watch the council → Inject event → watch it recover → Export.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
          <section className="flex flex-col gap-1.5">
            <h3 className="panel-title">Panels</h3>
            {PANELS.map(([name, text]) => (
              <p key={name}>
                <span className="font-semibold">{name}</span> — <span className="text-muted-foreground">{text}</span>
              </p>
            ))}
          </section>
          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <h3 className="panel-title">Source of every message</h3>
              <p>
                <Pill tone="success">LLM</Pill> <span className="text-muted-foreground">written by the agent&apos;s live model call (model and latency shown)</span>
              </p>
              <p>
                <Pill tone="amber">FALLBACK</Pill> <span className="text-muted-foreground">rule-based policy, used only when a model call failed — always labeled</span>
              </p>
              <p>
                <Pill tone="stale">DETERMINISTIC</Pill> <span className="text-muted-foreground">engine, validator, or system record</span>
              </p>
              <p>
                <Pill tone="info">HUMAN</Pill> <span className="text-muted-foreground">Mission Control action</span>
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <h3 className="panel-title">Status colors (always with a word)</h3>
              <p className="flex flex-wrap gap-1">
                <Pill tone="success">PASS ✓ · ACCEPT · STANDARD</Pill>
                <Pill tone="amber">RESTRICTED · OVERRIDE</Pill>
                <Pill tone="danger">FAIL ✗ · REJECT · SACRIFICE · INVALID</Pill>
                <Pill tone="stale">STALE · SUPERSEDED</Pill>
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <h3 className="panel-title">Protocol (PDF steps)</h3>
              <ol className="list-inside list-decimal text-muted-foreground">
                {PROTOCOL_STEPS.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </div>
            <div className="flex flex-col gap-1">
              <h3 className="panel-title">Keyboard</h3>
              <p className="num text-xs text-muted-foreground">S start · E inject event · X export menu · / search transcript · F follow live · ? help</p>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
