'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MotionConfig } from 'motion/react';
import { Archive, WifiOff } from 'lucide-react';
import type { CouncilMessage, PublicState } from '@/domain/types';
import { setUnauthorizedHandler } from '@/client/api';
import { AresProvider, createAresStore, useAres, useAresApi } from '@/client/store';
import { currentScenario } from '@/client/selectors';
import { useAresStream } from '@/client/use-ares-stream';
import { useMediaQuery } from '@/client/use-media-query';
import { Button } from '@/components/ui/button';
import { CouncilRoster } from './council-roster';
import { IdleHero } from './idle-hero';
import { JudgeControls, controlState } from './judge-controls';
import { MissionControl } from './mission-control';
import { RightPanel } from './right-panel';
import { StatusBar } from './status-bar';
import { Transcript } from './transcript/transcript';
import { AgentMindSheet } from './agent-mind-sheet';
import { InjectEventDialog } from './dialogs/inject-event-dialog';
import { SettingsSheet } from './dialogs/settings-sheet';
import { HelpDialog, JudgeCodeDialog, ResetDialog, StartDialog } from './dialogs/simple-dialogs';

/** The live Mission Control dashboard at `/`. */
export function LiveDashboard({ debug = false }: { debug?: boolean }) {
  return (
    <AresProvider>
      <MotionConfig reducedMotion="user">
        <LiveShell debug={debug} />
      </MotionConfig>
    </AresProvider>
  );
}

/** The same components over a static snapshot (Session Archive): no stream, no controls. */
export function ArchivedDashboard({ state, messages }: { state: PublicState; messages: CouncilMessage[] }) {
  const [store] = useState(() => createAresStore({ readOnly: true, state, messages }));
  return (
    <AresProvider store={store}>
      <MotionConfig reducedMotion="user">
        <Shell archived />
      </MotionConfig>
    </AresProvider>
  );
}

function LiveShell({ debug }: { debug: boolean }) {
  const { reconnect } = useAresStream(true);
  const openDialog = useAres((s) => s.openDialog);
  useEffect(() => {
    setUnauthorizedHandler(() => openDialog('judgeCode'));
    return () => setUnauthorizedHandler(() => undefined);
  }, [openDialog]);
  useShortcuts();
  return <Shell reconnect={reconnect} debug={debug} />;
}

function Shell({ archived = false, reconnect, debug = false }: { archived?: boolean; reconnect?: () => void; debug?: boolean }) {
  const hasState = useAres((s) => s.state !== null);
  const started = useAres((s) => (s.state?.scenarios.length ?? 0) > 0);
  const [mobileTab, setMobileTab] = useState<'transcript' | 'board' | 'validation' | 'more'>('transcript');
  usePresentation();
  useHashAnchor();

  // One layout is mounted at a time (no hidden duplicates: element ids and anchors stay unique).
  const desktop = useMediaQuery('(min-width: 1024px)');
  const xl = useMediaQuery('(min-width: 1280px)');
  const wide = useMediaQuery('(min-width: 1440px)');
  const center = !hasState ? <CenterSkeleton /> : started || archived ? <Transcript /> : <IdleHero />;

  return (
    <div className="flex min-h-dvh flex-col xl:h-dvh xl:overflow-hidden">
      <StatusBar archived={archived} />
      {archived && <ArchiveBanner />}
      {reconnect && <OfflineBanner reconnect={reconnect} />}
      <Announcer />
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        <div className={archived ? 'grid gap-3' : 'grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px]'}>
          <MissionControl />
          {!archived && <JudgeControls />}
        </div>
        {desktop && !xl && <CouncilRoster variant="strip" />}

        {/* ≥ 1024 px: independent scrolling columns */}
        {desktop && (
          <div className="grid h-[82vh] min-h-[560px] gap-3 lg:grid-cols-[minmax(0,1fr)_420px] xl:h-auto xl:min-h-0 xl:flex-1 xl:grid-cols-[76px_minmax(0,1fr)_420px] wide:grid-cols-[300px_minmax(0,1fr)_460px]">
            {xl && (
              <aside className="scrollbar-thin min-h-0 overflow-y-auto" aria-label="Council roster">
                <CouncilRoster variant={wide ? 'full' : 'compact'} />
              </aside>
            )}
            <main className="scrollbar-thin min-h-0 overflow-y-auto rounded-[10px] border bg-panel/40 p-3">{center}</main>
            <aside className="min-h-0 rounded-[10px] border bg-panel/40 p-3" aria-label="Plan panels">
              <RightPanel />
            </aside>
          </div>
        )}

        {/* < 1024 px: one column with top tabs */}
        {!desktop && (
          <div className="flex flex-col gap-3">
            <CouncilRoster variant="strip" />
            <div className="flex gap-1" role="tablist" aria-label="Views">
              {(['transcript', 'board', 'validation', 'more'] as const).map((t) => (
                <Button key={t} role="tab" aria-selected={mobileTab === t} size="sm" variant={mobileTab === t ? 'secondary' : 'ghost'} onClick={() => setMobileTab(t)}>
                  {t === 'transcript' ? 'Transcript' : t === 'board' ? 'Board' : t === 'validation' ? 'Validation' : 'More'}
                </Button>
              ))}
            </div>
            <div className="min-h-[70vh] rounded-[10px] border bg-panel/40 p-3">
              {mobileTab === 'transcript' ? (
                <div className="flex h-[70vh] flex-col">{center}</div>
              ) : mobileTab === 'board' ? (
                <RightPanel only={['board']} />
              ) : mobileTab === 'validation' ? (
                <RightPanel only={['validation']} />
              ) : (
                <div className="flex h-[70vh] flex-col">
                  <RightPanel only={['history', 'feasibility', 'compliance', 'ledger', 'analytics']} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {debug && (
        <Link href="/dev" className="fixed bottom-2 left-2 text-[10px] text-muted-foreground underline">
          debug console
        </Link>
      )}
      <AgentMindSheet />
      <SettingsSheet />
      <HelpDialog />
      {!archived && (
        <>
          <StartDialog />
          <InjectEventDialog />
          <ResetDialog />
          <JudgeCodeDialog />
        </>
      )}
    </div>
  );
}

function CenterSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading the council">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-[10px] bg-panel-2" />
      ))}
    </div>
  );
}

function ArchiveBanner() {
  const id = useAres((s) => s.state?.id);
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-info/30 bg-info/10 px-4 py-1.5 text-sm text-info">
      <Archive className="size-4" /> ARCHIVED SESSION — read-only <span className="num text-xs text-muted-foreground">{id}</span>
      <Link href="/sessions" className="ml-auto text-xs underline">
        Back to the archive
      </Link>
      <Link href="/" className="text-xs underline">
        Live council
      </Link>
    </div>
  );
}

function OfflineBanner({ reconnect }: { reconnect: () => void }) {
  const connection = useAres((s) => s.connection);
  if (connection !== 'offline') return null;
  return (
    <div className="flex items-center gap-2 border-b border-danger/40 bg-danger/10 px-4 py-1.5 text-sm text-danger" role="alert">
      <WifiOff className="size-4" /> Lost the live stream for 30 s. The server may have restarted.
      <Button size="sm" variant="outline" className="ml-auto h-7" onClick={reconnect}>
        Reconnect
      </Button>
    </div>
  );
}

/** Announces outcomes and phase changes only (not every message) to screen readers. */
function Announcer() {
  const text = useAres((s) => {
    if (!s.state) return '';
    const sc = currentScenario(s.state);
    if (!sc) return 'Council standing by.';
    if (sc.outcome) return `${sc.id} ${sc.outcome}${sc.approvedPlanVersion ? `: plan v${sc.approvedPlanVersion}` : ''}.`;
    return `${sc.id} round ${sc.round}: ${s.state.run.phase.toLowerCase()}.`;
  });
  return (
    <div aria-live="polite" className="sr-only">
      {text}
    </div>
  );
}

function usePresentation() {
  const presentation = useAres((s) => s.ui.presentation);
  const api = useAresApi();
  useEffect(() => {
    try {
      if (localStorage.getItem('ares.presentation') === '1') api.getState().setUi({ presentation: true });
    } catch {
      // storage unavailable
    }
  }, [api]);
  useEffect(() => {
    document.documentElement.dataset.presentation = presentation ? 'true' : 'false';
  }, [presentation]);
}

/** `#M-0042` in the URL scrolls to and flashes that message. */
function useHashAnchor() {
  const api = useAresApi();
  const hasMessages = useAres((s) => s.messages.length > 0);
  useEffect(() => {
    const go = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (/^M-\d+$/.test(id)) api.getState().highlight(id);
    };
    if (hasMessages) go();
    window.addEventListener('hashchange', go);
    return () => window.removeEventListener('hashchange', go);
  }, [api, hasMessages]);
}

function useShortcuts() {
  const api = useAresApi();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      if (document.querySelector('[role="dialog"]')) return;
      const s = api.getState();
      const c = controlState(s.state);
      switch (e.key) {
        case 's':
        case 'S':
          if (c.start.enabled) s.openDialog('start');
          break;
        case 'e':
        case 'E':
          if (c.inject.enabled) s.openDialog('inject');
          break;
        case 'x':
        case 'X':
          (document.querySelector('[data-export-trigger]') as HTMLButtonElement | null)?.click();
          break;
        case '/':
          e.preventDefault();
          document.getElementById('transcript-search')?.focus();
          break;
        case 'f':
        case 'F':
          s.setUi({ focusScenarioId: null, autoScroll: true });
          break;
        case '?':
          s.openDialog('help');
          break;
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [api]);
}
