'use client';

import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { Check, CircleDashed, Minus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getMode, isModeId } from '@/domain/scenario';
import { RESOURCE_KEYS, type ActorId, type CouncilMessage, type ResourceVector, type SacrificeStance, type Vote } from '@/domain/types';
import { RESOURCE_LABEL } from '@/domain/constants';
import { ACTOR_META, SOURCE_TONE, TIER_TONE, TONE_CLASS, type Tone } from '@/client/theme';
import { hash8, secs } from '@/client/format';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function Tip({ content, children, side }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  if (!content) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} className="max-w-sm text-left leading-relaxed">
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

export function Pill({ tone = 'muted', children, className, icon }: { tone?: Tone; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-[6px] border px-1.5 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap', TONE_CLASS[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export function AgentEmblem({ id, size = 22, className }: { id: ActorId; size?: number; className?: string }) {
  const meta = ACTOR_META[id];
  const Icon = meta.icon;
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full', className)}
      style={{ width: size, height: size, backgroundColor: `${meta.color}26`, boxShadow: `inset 0 0 0 1px ${meta.color}80`, color: meta.color }}
    >
      <Icon style={{ width: size * 0.58, height: size * 0.58 }} />
    </span>
  );
}

export function ActorLabel({ id, dept = true, size = 20 }: { id: ActorId; dept?: boolean; size?: number }) {
  const meta = ACTOR_META[id];
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <AgentEmblem id={id} size={size} />
      <span className="font-semibold tracking-wide" style={{ color: meta.color }}>
        {meta.callsign}
      </span>
      {dept && <span className="meta-secondary truncate text-muted-foreground">· {meta.dept}</span>}
    </span>
  );
}

export function TierPill({ modeId, withRisk = false }: { modeId: string | null | undefined; withRisk?: boolean }) {
  if (!modeId || !isModeId(modeId)) return <Pill>—</Pill>;
  const mode = getMode(modeId);
  return (
    <Pill tone={TIER_TONE[mode.tier]}>
      <span className="num">{mode.id}</span> {mode.tier}
      {withRisk && <span className="num opacity-80">· risk {mode.risk}</span>}
    </Pill>
  );
}

export function ModeChips({ selections }: { selections: Record<string, string> }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {Object.values(selections).map((m) => (
        <Tip key={m} content={isModeId(m) ? `${getMode(m).tier}: ${getMode(m).consequence}` : null}>
          <span className={cn('num rounded-[6px] border px-1.5 py-0.5 text-[11px]', isModeId(m) ? TONE_CLASS[TIER_TONE[getMode(m).tier]] : TONE_CLASS.muted)}>{m}</span>
        </Tip>
      ))}
    </span>
  );
}

export function Verdict({ status, size = 'sm', label }: { status: 'PASS' | 'FAIL' | 'SKIP'; size?: 'sm' | 'lg'; label?: ReactNode }) {
  const tone: Tone = status === 'PASS' ? 'success' : status === 'FAIL' ? 'danger' : 'muted';
  const Icon = status === 'PASS' ? Check : status === 'FAIL' ? X : Minus;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-[6px] border font-semibold', TONE_CLASS[tone], size === 'lg' ? 'px-3 py-1.5 text-lg' : 'px-1.5 py-0.5 text-[11px]')}>
      <Icon className={size === 'lg' ? 'size-5' : 'size-3'} aria-hidden />
      {status}
      {label}
    </span>
  );
}

export function SourceBadge({ m }: { m: Pick<CouncilMessage, 'source' | 'meta'> }) {
  const tone = SOURCE_TONE[m.source];
  if (m.source === 'LLM') {
    return (
      <Tip content={m.meta ? `${m.meta.model} · ${m.meta.attempts} attempt(s)${m.meta.inputTokens ? ` · ${m.meta.inputTokens} in / ${m.meta.outputTokens ?? 0} out tokens` : ''}${m.meta.traceId ? ` · trace ${m.meta.traceId}` : ''}` : 'Written by the live model'}>
        <span>
          <Pill tone={tone}>
            LLM{m.meta && <span className="meta-secondary num opacity-80">{m.meta.model} {secs(m.meta.latencyMs)}</span>}
          </Pill>
        </span>
      </Tip>
    );
  }
  if (m.source === 'FALLBACK') {
    return (
      <Tip content={`Rule-based fallback policy (labeled as required) — reason: ${m.meta?.fallbackReason ?? 'model unavailable'}`}>
        <span>
          <Pill tone={tone}>FALLBACK</Pill>
        </span>
      </Tip>
    );
  }
  return <Pill tone={tone}>{m.source}</Pill>;
}

export function VersionChip({ version, hash, size = 'sm' }: { version: number | null | undefined; hash?: string | null; size?: 'sm' | 'lg' }) {
  const reduce = useReducedMotion();
  if (!version) return <span className="num text-muted-foreground">—</span>;
  return (
    <motion.span
      key={version}
      initial={reduce ? false : { scale: 1 }}
      animate={reduce ? undefined : { scale: [1, 1.12, 1] }}
      transition={{ duration: 0.35 }}
      className={cn('num inline-flex items-center gap-1 rounded-[6px] border border-mars/50 bg-mars/10 font-semibold text-mars', size === 'lg' ? 'px-2 py-1 text-base' : 'px-1.5 py-0.5 text-[11px]')}
    >
      v{version}
      {hash && <span className="meta-secondary font-normal text-muted-foreground">{hash8(hash)}</span>}
    </motion.span>
  );
}

export function VoteLight({ vote, label }: { vote: Vote | null | undefined; label?: string }) {
  const reduce = useReducedMotion();
  const tone = !vote ? 'bg-stale/30 animate-pulse' : vote.decision === 'ACCEPT' ? 'bg-success' : 'bg-danger';
  const Icon = !vote ? CircleDashed : vote.decision === 'ACCEPT' ? Check : X;
  return (
    <Tip content={vote ? `${vote.decision} v${vote.planVersion}: ${vote.reason}` : `${label ?? ''} pending`}>
      <motion.span
        key={vote?.id ?? 'pending'}
        initial={reduce || !vote ? false : { rotateX: 90, opacity: 0 }}
        animate={{ rotateX: 0, opacity: 1 }}
        transition={{ duration: 0.3 }}
        className={cn('inline-flex size-5 items-center justify-center rounded-full text-background', tone)}
        aria-label={vote ? `${label ?? ''} ${vote.decision}` : `${label ?? ''} vote pending`}
        role="img"
      >
        <Icon className={cn('size-3', !vote && 'text-muted-foreground')} />
      </motion.span>
    </Tip>
  );
}

const STANCE_TONE: Record<SacrificeStance, Tone> = { REFUSE: 'danger', CONDITIONAL: 'amber', ACCEPT: 'success', NOT_ASKED: 'muted' };

export function StanceBadge({ stance, conditions }: { stance: SacrificeStance | null | undefined; conditions?: string[] }) {
  if (!stance || stance === 'NOT_ASKED') return null;
  return (
    <Tip content={conditions?.length ? `Conditions: ${conditions.join('; ')}` : null}>
      <span>
        <Pill tone={STANCE_TONE[stance]}>Sacrifice: {stance}</Pill>
      </span>
    </Tip>
  );
}

/** "P79/79 W50/52 …" with over-limit values in danger color. */
export function VecVs({ totals, cap, className }: { totals: ResourceVector; cap?: ResourceVector; className?: string }) {
  return (
    <span className={cn('num inline-flex flex-wrap gap-x-2 gap-y-0.5 text-[12px]', className)}>
      {RESOURCE_KEYS.map((k) => {
        const over = cap ? totals[k] - cap[k] : 0;
        return (
          <span key={k} className={over > 0 ? 'font-semibold text-danger' : undefined}>
            {RESOURCE_LABEL[k].short}
            {totals[k]}
            {cap && <span className={over > 0 ? undefined : 'text-muted-foreground'}>/{cap[k]}</span>}
            {over > 0 && <span> (+{over})</span>}
          </span>
        );
      })}
    </span>
  );
}

export function Vec({ v, className }: { v: ResourceVector; className?: string }) {
  return (
    <span className={cn('num inline-flex flex-wrap gap-x-2 text-[12px]', className)}>
      {RESOURCE_KEYS.map((k) => (
        <span key={k}>
          {RESOURCE_LABEL[k].short}
          {v[k]}
        </span>
      ))}
    </span>
  );
}

export function ThinkingDots({ color }: { color: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className="thinking-dot size-1.5 rounded-full" style={{ backgroundColor: color }} />
      ))}
    </span>
  );
}

export function PanelTitle({ children, right, className }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-2', className)}>
      <h2 className="panel-title">{children}</h2>
      {right}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">{children}</p>;
}
