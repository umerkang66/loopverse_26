'use client';

import { cn } from '@/lib/utils';
import { AGENT_IDS, type AgentId, type CouncilMessage, type PublicState } from '@/domain/types';
import { useAres } from '@/client/store';
import { boardPlan, focusScenario, votesFor } from '@/client/selectors';
import { ACTOR_META, MESSAGE_TYPE_META } from '@/client/theme';
import { AgentEmblem, PanelTitle, StanceBadge, ThinkingDots, Tip, TierPill, VoteLight } from './bits';

const PHASE_VERB: Record<string, string> = {
  BRIEFING: 'briefing the council',
  POSITIONS: 'stating its position',
  SYNTHESIS: 'drafting',
  CONSENT: 'giving consent',
  VALIDATION: 'validating',
  VOTING: 'voting',
  DECISION: 'deciding',
  REVIEW: 'reviewing',
  EVENT_INTAKE: 'reading the event',
};

function activity(state: PublicState, id: AgentId, messages: CouncilMessage[]): { thinking: boolean; text: string } {
  const thinking = state.run.activeAgents.includes(id) || state.agents[id].status === 'THINKING';
  if (thinking) {
    const verb = PHASE_VERB[state.run.phase] ?? 'thinking';
    const next = id === 'COMMANDER' && state.run.phase === 'SYNTHESIS' ? `drafting v${(state.counters.plan ?? 0) + 1}` : verb;
    return { thinking, text: `${next}…` };
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.from === id) return { thinking, text: `${MESSAGE_TYPE_META[m.type].label}${m.subtype ? ` · ${m.subtype.toLowerCase().replaceAll('_', ' ')}` : ''} · R${m.round}` };
  }
  return { thinking, text: 'standing by' };
}

export function CouncilRoster({ variant = 'full' }: { variant?: 'full' | 'compact' | 'strip' }) {
  const state = useAres((s) => s.state);
  const messages = useAres((s) => s.messages);
  const focusId = useAres((s) => s.ui.focusScenarioId);
  const showInForce = useAres((s) => s.ui.showPlanInForce);
  const setUi = useAres((s) => s.setUi);
  if (!state) return null;
  const sc = focusScenario(state, focusId);
  const plan = boardPlan(state, sc, showInForce);
  const votes = votesFor(plan);

  if (variant === 'compact' || variant === 'strip') {
    return (
      <nav aria-label="Council" className={cn('flex gap-2', variant === 'compact' ? 'flex-col items-center py-2' : 'flex-row flex-wrap items-center')}>
        {AGENT_IDS.map((id) => {
          const a = activity(state, id, messages);
          const meta = ACTOR_META[id];
          return (
            <Tip key={id} side="right" content={`${meta.callsign} · ${meta.dept} — ${a.text}${state.agents[id].requestedMode ? ` · wants ${state.agents[id].requestedMode}` : ''}`}>
              <button
                type="button"
                onClick={() => setUi({ selectedAgent: id })}
                className={cn('flex items-center gap-1.5 rounded-full p-0.5', a.thinking && 'ring-2 ring-offset-2 ring-offset-background')}
                style={a.thinking ? ({ '--tw-ring-color': meta.color } as React.CSSProperties) : undefined}
                aria-label={`Open ${meta.callsign} agent mind`}
              >
                <AgentEmblem id={id} size={variant === 'compact' ? 34 : 26} />
                {variant === 'strip' && <span className="pr-2 text-xs font-semibold" style={{ color: meta.color }}>{meta.callsign}</span>}
              </button>
            </Tip>
          );
        })}
      </nav>
    );
  }

  return (
    <nav aria-label="Council" className="flex flex-col gap-2">
      <PanelTitle>Council</PanelTitle>
      {AGENT_IDS.map((id) => {
        const meta = ACTOR_META[id];
        const agent = state.agents[id];
        const a = activity(state, id, messages);
        const vote = id === 'COMMANDER' ? null : votes[id];
        const stance = agent.stance && (!sc || agent.stance.scenarioId === sc.id) ? agent.stance : null;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setUi({ selectedAgent: id })}
            className="group flex flex-col gap-1.5 rounded-[10px] border border-border bg-panel p-2.5 text-left transition-colors hover:border-border hover:bg-panel-2"
            style={{ borderLeft: `3px solid ${meta.color}` }}
            aria-label={`${meta.callsign}, ${meta.dept}. Open agent mind`}
          >
            <div className="flex items-center gap-2">
              <AgentEmblem id={id} size={26} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold tracking-wide" style={{ color: meta.color }}>
                    {meta.callsign}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{meta.dept}</span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  {a.thinking && <ThinkingDots color={meta.color} />}
                  <span className="truncate">{a.text}</span>
                </div>
              </div>
              {id !== 'COMMANDER' && plan && <VoteLight vote={vote} label={meta.callsign} />}
            </div>
            {id !== 'COMMANDER' && (
              <div className="flex flex-wrap items-center gap-1">
                {agent.requestedMode && (
                  <span className="text-[11px] text-muted-foreground">
                    wants <TierPill modeId={agent.requestedMode} />
                  </span>
                )}
                <StanceBadge stance={stance?.sacrifice} conditions={stance?.conditions} />
              </div>
            )}
            <div className="meta-secondary num flex gap-2 text-[10px] text-muted-foreground">
              <span>LLM {agent.stats.llmCalls}</span>
              <span className={agent.stats.fallbacks ? 'text-amber' : undefined}>FALLBACK {agent.stats.fallbacks}</span>
              <span>memory {agent.memory.length}</span>
            </div>
          </button>
        );
      })}
    </nav>
  );
}
