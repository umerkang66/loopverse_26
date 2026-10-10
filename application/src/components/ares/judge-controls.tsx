'use client';

import { Download, Menu, Play, RotateCcw, Settings, StepForward, Zap } from 'lucide-react';
import { toast } from 'sonner';
import type { ReactNode } from 'react';
import type { PublicState } from '@/domain/types';
import { api, exportUrl, type ExportKind } from '@/client/api';
import { useAres } from '@/client/store';
import { currentScenario } from '@/client/selectors';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PanelTitle, Tip } from './bits';

export const EXPORT_ITEMS: { kind: ExportKind; label: string; hint: string }[] = [
  { kind: 'json', label: 'Session JSON', hint: 'Everything: scenarios, plans, votes, commitments, messages, agent state, compliance' },
  { kind: 'transcript', label: 'Transcript CSV', hint: 'One row per message (source column labels FALLBACK)' },
  { kind: 'plans', label: 'Plans CSV', hint: 'Every plan version with totals, validation, votes, hash' },
  { kind: 'votes', label: 'Votes CSV', hint: 'Every ballot bound to its version and hash' },
  { kind: 'commitments', label: 'Commitments CSV', hint: 'The return-commitment ledger with history' },
  { kind: 'final', label: 'Final allocation (output_schema)', hint: 'final_allocation.json with one output_schema record per department' },
  { kind: 'evidence', label: 'Evidence pack (.zip)', hint: 'Allocation, transcripts, opening + post-event logs, crisis log, compliance, manifest with SHA-256 and database row-count parity' },
];

export interface ControlState {
  start: { enabled: boolean; why: string };
  inject: { enabled: boolean; why: string; interrupts: boolean };
  resume: { enabled: boolean; why: string };
}

export function controlState(state: PublicState | null): ControlState {
  if (!state) return { start: { enabled: false, why: 'Connecting…' }, inject: { enabled: false, why: 'Connecting…', interrupts: false }, resume: { enabled: false, why: 'Connecting…' } };
  const sc = currentScenario(state);
  const notStarted = state.scenarios.length === 0 || state.scenarios[0]?.status === 'PENDING';
  const running = sc?.status === 'NEGOTIATING';
  const resumable = sc?.status === 'RESOLVED' && !!sc.outcome && ['DEADLOCK', 'TIMEOUT', 'INTERRUPTED'].includes(sc.outcome) && !running;
  return {
    start: { enabled: state.run.status === 'IDLE' && notStarted, why: notStarted ? 'Enter resources and start the crisis' : 'The crisis has already started — Reset to start a new council' },
    inject: {
      enabled: !notStarted,
      interrupts: running,
      why: notStarted ? 'Start the crisis first' : running ? 'Negotiation in progress — injecting will interrupt it (you will confirm)' : 'Inject a new event: presets, official JSON, or manual changes',
    },
    resume: { enabled: resumable, why: resumable ? `Resume ${sc?.id} with two more rounds` : 'Available after a DEADLOCK, TIMEOUT or INTERRUPTED result' },
  };
}

export async function resumeCouncil(): Promise<void> {
  try {
    const res = await api.resume();
    toast.success(`${res.scenarioId} resumed — two more rounds`);
  } catch {
    // toast already shown
  }
}

export function JudgeControls() {
  const state = useAres((s) => s.state);
  const openDialog = useAres((s) => s.openDialog);
  const c = controlState(state);
  return (
    <section aria-labelledby="judge-controls" className="flex h-full flex-col gap-2 rounded-[10px] border bg-panel p-3">
      <PanelTitle>
        <span id="judge-controls">Judge Controls</span>
      </PanelTitle>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 xl:grid-cols-2">
        <Control why={c.start.why} disabled={!c.start.enabled}>
          <Button onClick={() => openDialog('start')} disabled={!c.start.enabled} className="w-full">
            <Play /> Start crisis
          </Button>
        </Control>
        <Control why={c.inject.why} disabled={!c.inject.enabled}>
          <Button variant="outline" onClick={() => openDialog('inject')} disabled={!c.inject.enabled} className="w-full border-amber/40 text-amber">
            <Zap /> Inject event
          </Button>
        </Control>
        <Control why={c.resume.why} disabled={!c.resume.enabled}>
          <Button variant="outline" onClick={() => void resumeCouncil()} disabled={!c.resume.enabled} className="w-full">
            <StepForward /> Resume
          </Button>
        </Control>
        <Control why="Archive this session (history stays in the Session Archive) and start a fresh council">
          <Button variant="outline" onClick={() => openDialog('reset')} className="w-full">
            <RotateCcw /> Reset
          </Button>
        </Control>
        <ExportMenu className="w-full" />
        <Button variant="ghost" onClick={() => openDialog('settings')} className="w-full">
          <Settings /> Settings
        </Button>
      </div>
    </section>
  );
}

function Control({ why, disabled, children }: { why: string; disabled?: boolean; children: ReactNode }) {
  // Disabled buttons don't fire pointer events, so the tooltip sits on a wrapper.
  return (
    <Tip content={why}>
      <span className="block" tabIndex={disabled ? 0 : -1}>
        {children}
      </span>
    </Tip>
  );
}

export function ExportMenu({ className, sessionId }: { className?: string; sessionId?: string | null }) {
  const focusId = useAres((s) => s.ui.focusScenarioId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className={className} data-export-trigger>
          <Download /> Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Download {sessionId ? 'archived session' : 'this session'}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {EXPORT_ITEMS.map((item) => (
          <DropdownMenuItem key={item.kind} asChild>
            <a href={exportUrl(item.kind, { sessionId, scenarioId: focusId })} download className="flex flex-col items-start gap-0.5">
              <span>{item.label}</span>
              <span className="text-[11px] text-muted-foreground">{item.hint}</span>
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Compact mirror of Judge Controls for the header (narrow screens and keyboard users). */
export function ControlsMenu() {
  const state = useAres((s) => s.state);
  const openDialog = useAres((s) => s.openDialog);
  const c = controlState(state);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Judge controls menu" className="xl:hidden">
          <Menu />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Judge Controls</DropdownMenuLabel>
        <DropdownMenuItem disabled={!c.start.enabled} onSelect={() => openDialog('start')}>
          <Play /> Start crisis
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!c.inject.enabled} onSelect={() => openDialog('inject')}>
          <Zap /> Inject event
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!c.resume.enabled} onSelect={() => void resumeCouncil()}>
          <StepForward /> Resume
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openDialog('reset')}>
          <RotateCcw /> Reset
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {EXPORT_ITEMS.map((item) => (
          <DropdownMenuItem key={item.kind} asChild>
            <a href={exportUrl(item.kind)} download>
              <Download /> {item.label}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
