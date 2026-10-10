'use client';

import { useState } from 'react';
import { ChevronDown, Play } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { RESOURCE_LABEL } from '@/domain/constants';
import { INITIAL_POOL } from '@/domain/scenario';
import { RESOURCE_KEYS, type ResourceKey, type ResourceVector } from '@/domain/types';
import { evaluateAll } from '@/engine/optimizer';
import { basePolicy } from '@/engine/policy';
import { api } from '@/client/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

type Draft = Record<ResourceKey, string>;
const toDraft = (v: ResourceVector): Draft => Object.fromEntries(RESOURCE_KEYS.map((k) => [k, String(v[k])])) as Draft;

function parse(d: Draft): { pool: ResourceVector | null; errors: Partial<Record<ResourceKey, string>> } {
  const errors: Partial<Record<ResourceKey, string>> = {};
  const pool = {} as ResourceVector;
  for (const k of RESOURCE_KEYS) {
    const n = Number(d[k]);
    if (d[k].trim() === '' || !Number.isInteger(n) || n < 0 || n > 999) errors[k] = 'Integer 0–999';
    else pool[k] = n;
  }
  return { pool: Object.keys(errors).length ? null : pool, errors };
}

/** Resource entry with a live, client-side feasibility preview (the same pure engine the server uses). */
export function ResourceEditor({ onStarted, autoFocus = false }: { onStarted?: () => void; autoFocus?: boolean }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(INITIAL_POOL));
  const [maxRounds, setMaxRounds] = useState('');
  const [deadline, setDeadline] = useState('');
  const [busy, setBusy] = useState(false);
  const { pool, errors } = parse(draft);
  const feasible = pool ? evaluateAll({ pool, reserveRequirements: {}, forbiddenModes: [], riskCap: null, maxSacrificesCap: null }, basePolicy()).filter((e) => e.feasible) : null;
  const changed = RESOURCE_KEYS.some((k) => draft[k] !== String(INITIAL_POOL[k]));
  const advancedError =
    (maxRounds && (!Number.isInteger(Number(maxRounds)) || Number(maxRounds) < 1 || Number(maxRounds) > 12) ? 'Max rounds: 1–12. ' : '') +
    (deadline && (!Number.isInteger(Number(deadline)) || Number(deadline) < 30 || Number(deadline) > 1800) ? 'Deadline: 30–1800 s.' : '');

  const start = async () => {
    if (!pool || advancedError) return;
    setBusy(true);
    try {
      await api.start({ resources: pool, ...(maxRounds ? { maxRounds: Number(maxRounds) } : {}), ...(deadline ? { deadlineSeconds: Number(deadline) } : {}) });
      toast.success('Crisis started — the Commander is briefing the council');
      onStarted?.();
    } catch {
      // toast shown by the API client
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void start();
      }}
    >
      <div className="grid grid-cols-5 gap-2">
        {RESOURCE_KEYS.map((k, i) => (
          <div key={k} className="flex flex-col gap-1">
            <Label htmlFor={`res-${k}`} className="text-xs text-muted-foreground">
              {RESOURCE_LABEL[k].name}
            </Label>
            <Input
              id={`res-${k}`}
              inputMode="numeric"
              autoFocus={autoFocus && i === 0}
              value={draft[k]}
              aria-invalid={!!errors[k]}
              aria-describedby={errors[k] ? `res-${k}-err` : undefined}
              onChange={(e) => setDraft({ ...draft, [k]: e.target.value.replace(/[^0-9]/g, '').slice(0, 3) })}
              className="num h-9 text-center text-base"
            />
            {errors[k] && (
              <span id={`res-${k}-err`} className="text-[10px] text-danger">
                {errors[k]}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p role="status" aria-live="polite" className={cn(feasible && feasible.length === 0 ? 'text-danger' : 'text-muted-foreground')}>
          {feasible === null
            ? 'Enter five integers between 0 and 999.'
            : feasible.length === 0
              ? 'With these resources: 0 feasible plans under baseline limits — the council will prove INFEASIBLE and state exactly what it needs.'
              : `With these resources: ${feasible.length} feasible plan${feasible.length === 1 ? '' : 's'} under baseline limits (${feasible
                  .slice(0, 3)
                  .map((e) => e.key)
                  .join(', ')}${feasible.length > 3 ? ', …' : ''}).`}
        </p>
        {changed && (
          <button type="button" className="text-xs text-info hover:underline" onClick={() => setDraft(toDraft(INITIAL_POOL))}>
            Reset to guide values (79/52/59/26/17)
          </button>
        )}
      </div>
      <Collapsible>
        <CollapsibleTrigger className="group inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" /> Advanced
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-wrap gap-3 pt-2">
          <label className="flex items-center gap-2 text-xs">
            Max rounds
            <Input value={maxRounds} onChange={(e) => setMaxRounds(e.target.value.replace(/[^0-9]/g, ''))} placeholder="6" className="num h-8 w-16" />
          </label>
          <label className="flex items-center gap-2 text-xs">
            Deadline (s)
            <Input value={deadline} onChange={(e) => setDeadline(e.target.value.replace(/[^0-9]/g, ''))} placeholder="300" className="num h-8 w-20" />
          </label>
          {advancedError && <span className="text-xs text-danger">{advancedError}</span>}
        </CollapsibleContent>
      </Collapsible>
      <Button type="submit" size="lg" disabled={!pool || busy || !!advancedError} className="h-11 text-base">
        <Play /> {busy ? 'Starting…' : 'Start crisis'}
      </Button>
    </form>
  );
}
