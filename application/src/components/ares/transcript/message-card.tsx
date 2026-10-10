'use client';

import { memo, useState } from 'react';
import { Braces, FileJson, Link2, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { CouncilMessage } from '@/domain/types';
import { ACTOR_META, MESSAGE_TYPE_META, OBJECTION_LABEL } from '@/client/theme';
import { clock } from '@/client/format';
import { useAres } from '@/client/store';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ActorLabel, Pill, SourceBadge, Tip } from '../bits';
import { MessageBody } from './bodies';

function Recipients({ m }: { m: CouncilMessage }) {
  if (m.to === 'ALL') return <span className="text-muted-foreground">→ ALL</span>;
  return (
    <span className="text-muted-foreground">
      →{' '}
      {m.to.map((id, i) => (
        <span key={id} style={{ color: ACTOR_META[id].color }}>
          {i > 0 ? ', ' : ''}
          {ACTOR_META[id].callsign}
        </span>
      ))}
    </span>
  );
}

function TypeBadge({ m }: { m: CouncilMessage }) {
  const meta = MESSAGE_TYPE_META[m.type];
  const Icon = m.type === 'VALIDATION' && m.subtype === 'FAIL' ? MESSAGE_TYPE_META.VALIDATION.icon : meta.icon;
  const sub = m.subtype ? (OBJECTION_LABEL[m.subtype] ?? m.subtype.replaceAll('_', ' ').toLowerCase()) : null;
  const tone = m.subtype === 'SACRIFICE_REFUSAL' || m.type === 'OBJECTION' ? 'danger' : m.type === 'APPROVAL' ? 'success' : m.type === 'EVENT' ? 'amber' : m.type === 'PLAN_DRAFT' ? 'mars' : 'muted';
  return (
    <Pill tone={tone} icon={<Icon className="size-3" />}>
      {meta.label.toUpperCase()}
      {sub && <span className="font-normal opacity-80">· {sub}</span>}
    </Pill>
  );
}

/** The four PDF fields (agent, type, round, plan version) plus recipients, time, source, and tool calls. */
export function MessageMeta({ m, showActor = true, showSource = true }: { m: CouncilMessage; showActor?: boolean; showSource?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {showActor && <ActorLabel id={m.from} />}
      <TypeBadge m={m} />
      <span className="num rounded-[6px] border border-border px-1 text-muted-foreground" title="Round">
        R{m.round}
      </span>
      {m.planVersion ? (
        <span className="num rounded-[6px] border border-mars/30 px-1 text-mars/90" title="Plan version">
          v{m.planVersion}
        </span>
      ) : null}
      <Recipients m={m} />
      <span className="meta-secondary num text-muted-foreground">{clock(m.createdAt)}</span>
      {showSource && <SourceBadge m={m} />}
    </div>
  );
}

export function ToolChips({ m }: { m: CouncilMessage }) {
  const calls = m.meta?.toolCalls ?? [];
  if (calls.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {calls.map((t, i) => (
        <Tip key={i} content={<span className="num block max-h-48 overflow-auto whitespace-pre-wrap text-[11px]">{`args: ${t.args}\n→ ${t.result}`}</span>}>
          <span className="num inline-flex items-center gap-1 rounded-[6px] border border-info/30 bg-info/5 px-1.5 py-0.5 text-[11px] text-info">
            <Wrench className="size-3" aria-hidden /> {t.name} → {t.result.slice(0, 60)}
            {t.result.length > 60 ? '…' : ''}
          </span>
        </Tip>
      ))}
    </div>
  );
}

function Footer({ m }: { m: CouncilMessage }) {
  const record = (m.data as { outputSchemaRecord?: unknown }).outputSchemaRecord;
  const copyLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}#${m.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(`Link to ${m.id} copied`);
    } catch {
      toast.info(url);
    }
    window.history.replaceState(null, '', `#${m.id}`);
  };
  return (
    <div className="meta-secondary flex gap-3 pt-0.5 text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100">
      <JsonPopover label="Record" icon={<Braces className="size-3" />} value={m} />
      {record ? <JsonPopover label="output_schema" icon={<FileJson className="size-3" />} value={record} /> : null}
      <button type="button" onClick={() => void copyLink()} className="inline-flex items-center gap-1 hover:text-foreground">
        <Link2 className="size-3" /> {m.id}
      </button>
    </div>
  );
}

function JsonPopover({ label, icon, value }: { label: string; icon: React.ReactNode; value: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1 hover:text-foreground">
          {icon} {label}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[520px] max-w-[90vw]" align="start">
        {open && <pre className="num max-h-[420px] overflow-auto text-[11px] leading-snug whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>}
      </PopoverContent>
    </Popover>
  );
}

/** One typed message inside a turn group: its own type badge, body, and footer. */
export const MessageSection = memo(function MessageSection({ m, first }: { m: CouncilMessage; first: boolean }) {
  const refusal = m.subtype === 'SACRIFICE_REFUSAL';
  return (
    <article id={`msg-${m.id}`} aria-label={`${ACTOR_META[m.from].callsign} ${m.type} round ${m.round}`} className={cn('group/msg flex scroll-mt-24 flex-col gap-1.5 rounded-md px-1 py-1', refusal && 'ring-1 ring-danger/60 bg-danger/5')}>
      {!first && <MessageMeta m={m} showActor={false} showSource={false} />}
      <MessageBody m={m} />
      <Footer m={m} />
    </article>
  );
});

/** Consecutive messages of one agent turn render as one bordered group in the agent's color. */
export const TurnGroup = memo(function TurnGroup({ messages, fresh }: { messages: CouncilMessage[]; fresh: boolean }) {
  const head = messages[0]!;
  const meta = ACTOR_META[head.from];
  const compactSystem = head.type === 'SYSTEM' && messages.length === 1;
  if (compactSystem) {
    const Icon = MESSAGE_TYPE_META.SYSTEM.icon;
    return (
      <div id={`msg-${head.id}`} className={cn('group/msg cv-auto flex scroll-mt-24 flex-col gap-1 rounded-md px-3 py-1.5 text-xs', fresh && 'animate-in fade-in slide-in-from-bottom-2 duration-200')}>
        <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
          <Icon className="size-3.5 text-info" aria-hidden />
          <span className="font-semibold text-info">{head.subtype?.replaceAll('_', ' ') ?? 'SYSTEM'}</span>
          <span className="text-foreground/90">{head.summary}</span>
          <span className="num">R{head.round}</span>
          {head.planVersion ? <span className="num text-mars/80">v{head.planVersion}</span> : null}
          <span className="meta-secondary num">{clock(head.createdAt)}</span>
        </div>
        <MessageBody m={head} />
      </div>
    );
  }
  return (
    <div
      className={cn('cv-auto rounded-[10px] border border-border bg-panel/70 py-2 pr-3 pl-3', fresh && 'turn-glow animate-in fade-in slide-in-from-bottom-2 duration-200')}
      style={{ borderLeft: `3px solid ${meta.color}`, ['--glow' as string]: meta.color }}
    >
      <div className="mb-1 flex flex-col gap-1">
        <MessageMeta m={head} />
        <ToolChips m={head} />
      </div>
      <div className="flex flex-col gap-1.5">
        {messages.map((m, i) => (
          <MessageSection key={m.seq} m={m} first={i === 0} />
        ))}
      </div>
    </div>
  );
});
