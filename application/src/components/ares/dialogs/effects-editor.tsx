'use client';

import { Plus, Trash2 } from 'lucide-react';
import { RESOURCE_LABEL } from '@/domain/constants';
import { DEPARTMENT_IDS, MODE_IDS, RESOURCE_KEYS, type DepartmentId, type EffectOrigin, type EventEffect, type ModeId, type ResourceKey } from '@/domain/types';
import type { Tone } from '@/client/theme';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Pill } from '../bits';

const TYPES: EventEffect['type'][] = ['RESOURCE_DELTA', 'RESOURCE_PERCENT', 'RESOURCE_SET', 'RESERVE_REQUIREMENT', 'FORBID_MODE', 'ALLOW_MODE', 'RISK_LIMIT', 'MAX_SACRIFICES', 'PRIORITY', 'INFO'];

const ORIGIN_TONE: Record<EffectOrigin, Tone> = { parser: 'muted', llm: 'stale', judge: 'info' };
const ORIGIN_TIP: Record<EffectOrigin, string> = {
  parser: 'Read by the deterministic parser',
  llm: 'Added by the Event Intake officer (LLM)',
  judge: 'Written or edited by you',
};

const select = 'h-8 rounded-md border border-input bg-transparent px-2 text-xs dark:bg-input/30';

function blank(type: EventEffect['type']): EventEffect {
  switch (type) {
    case 'RESOURCE_DELTA':
    case 'RESOURCE_PERCENT':
    case 'RESOURCE_SET':
    case 'RESERVE_REQUIREMENT':
      return { type, resource: 'power', value: 0, origin: 'judge' };
    case 'FORBID_MODE':
      return { type, modeId: 'M3', reason: 'Set by Mission Control', origin: 'judge' };
    case 'ALLOW_MODE':
      return { type, modeId: 'M3', origin: 'judge' };
    case 'RISK_LIMIT':
      return { type, value: 22, origin: 'judge' };
    case 'MAX_SACRIFICES':
      return { type, value: 1, origin: 'judge' };
    case 'PRIORITY':
      return { type, department: null, note: '', origin: 'judge' };
    case 'INFO':
      return { type, note: '', origin: 'judge' };
  }
}

/** Every edit is attributed to the judge (full provenance is recorded in the EventRecord). */
const edited = (e: EventEffect): EventEffect => ({ ...e, origin: 'judge' }) as EventEffect;

/** Editable list of the interpretation's effects, each with an origin badge. */
export function EffectsEditor({ effects, onChange, disabled }: { effects: EventEffect[]; onChange: (effects: EventEffect[]) => void; disabled?: boolean }) {
  const update = (i: number, next: EventEffect) => onChange(effects.map((e, j) => (j === i ? next : e)));
  return (
    <div className="flex flex-col gap-1.5">
      {effects.length === 0 && <span className="text-sm text-muted-foreground">No effects yet.</span>}
      {effects.map((e, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5 rounded-md border bg-panel px-2 py-1.5">
          <Pill tone={ORIGIN_TONE[e.origin ?? 'parser']} className="w-[52px] justify-center" icon={undefined}>
            <span title={ORIGIN_TIP[e.origin ?? 'parser']}>{e.origin ?? 'parser'}</span>
          </Pill>
          <select
            aria-label="Effect type"
            className={select}
            value={e.type}
            disabled={disabled}
            onChange={(ev) => update(i, blank(ev.target.value as EventEffect['type']))}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {'resource' in e && (
            <select aria-label="Resource" className={select} value={e.resource} disabled={disabled} onChange={(ev) => update(i, edited({ ...e, resource: ev.target.value as ResourceKey }))}>
              {RESOURCE_KEYS.map((k) => (
                <option key={k} value={k}>
                  {RESOURCE_LABEL[k].name}
                </option>
              ))}
            </select>
          )}
          {'value' in e && (
            <Input
              aria-label="Value"
              type="number"
              className="num h-8 w-20"
              value={Number.isFinite(e.value) ? e.value : 0}
              disabled={disabled}
              onChange={(ev) => update(i, edited({ ...e, value: Number(ev.target.value) }))}
            />
          )}
          {(e.type === 'RESOURCE_PERCENT') && <span className="text-xs text-muted-foreground">%</span>}
          {'modeId' in e && (
            <select aria-label="Mode" className={select} value={e.modeId} disabled={disabled} onChange={(ev) => update(i, edited({ ...e, modeId: ev.target.value as ModeId }))}>
              {MODE_IDS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}
          {e.type === 'PRIORITY' && (
            <select aria-label="Department" className={select} value={e.department ?? ''} disabled={disabled} onChange={(ev) => update(i, edited({ ...e, department: (ev.target.value || null) as DepartmentId | null }))}>
              <option value="">(none)</option>
              {DEPARTMENT_IDS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          )}
          {(e.type === 'INFO' || e.type === 'PRIORITY' || e.type === 'FORBID_MODE') && (
            <Input
              aria-label="Note"
              className="h-8 min-w-40 flex-1 text-xs"
              value={e.type === 'FORBID_MODE' ? e.reason : e.note}
              disabled={disabled}
              onChange={(ev) => update(i, edited(e.type === 'FORBID_MODE' ? { ...e, reason: ev.target.value } : { ...e, note: ev.target.value }))}
            />
          )}
          <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove effect" disabled={disabled} onClick={() => onChange(effects.filter((_, j) => j !== i))} className="ml-auto">
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" className="self-start" disabled={disabled || effects.length >= 12} onClick={() => onChange([...effects, blank('RESOURCE_DELTA')])}>
        <Plus /> Add effect
      </Button>
    </div>
  );
}
