'use client';

import { AlertTriangle, HeartPulse, Users } from 'lucide-react';
import { PROFILES, SCENARIO } from '@/domain/scenario';
import { AGENT_IDS } from '@/domain/types';
import { useAres } from '@/client/store';
import { ACTOR_META } from '@/client/theme';
import { AgentEmblem } from './bits';
import { ResourceEditor } from './resource-editor';

/** Before Start: the crisis, the five loaded agents, and resource entry. */
export function IdleHero() {
  const setUi = useAres((s) => s.setUi);
  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-5 py-4" aria-labelledby="standing-by">
      <div className="flex flex-col gap-2 rounded-[10px] border border-mars/30 bg-panel p-4">
        <span className="panel-title flex items-center gap-1.5 text-mars">
          <AlertTriangle className="size-3.5" /> Council standing by
        </span>
        <h1 id="standing-by" className="text-2xl font-semibold tracking-tight">
          {SCENARIO.title}
        </h1>
        <p className="text-muted-foreground">{SCENARIO.narrative}</p>
        <div className="flex gap-4 text-sm">
          <span className="flex items-center gap-1.5">
            <Users className="size-4 text-info" aria-hidden /> <span className="num text-lg font-semibold">{SCENARIO.colony.crew}</span> crew
          </span>
          <span className="flex items-center gap-1.5">
            <HeartPulse className="size-4 text-danger" aria-hidden /> <span className="num text-lg font-semibold">{SCENARIO.colony.injured}</span> injured
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="panel-title">Five agents loaded — separate goals, state, and private sessions</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {AGENT_IDS.map((id) => {
            const p = PROFILES[id];
            const meta = ACTOR_META[id];
            return (
              <button
                key={id}
                type="button"
                onClick={() => setUi({ selectedAgent: id })}
                className="flex flex-col gap-1.5 rounded-[10px] border bg-panel p-3 text-left hover:bg-panel-2"
                style={{ borderTop: `3px solid ${meta.color}` }}
                aria-label={`${p.callsign}: open agent mind`}
              >
                <span className="flex items-center gap-2">
                  <AgentEmblem id={id} size={28} />
                  <span className="flex flex-col leading-tight">
                    <span className="font-semibold tracking-wide" style={{ color: meta.color }}>
                      {p.callsign}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{meta.dept}</span>
                  </span>
                </span>
                <span className="text-xs font-medium">{p.name}</span>
                <span className="text-xs text-muted-foreground">{p.mission}</span>
                <span className="text-[11px] text-amber">Concern: {p.mainConcern}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-[10px] border bg-panel p-4">
        <h2 className="panel-title">Enter the available resources</h2>
        <ResourceEditor />
      </div>
    </section>
  );
}
