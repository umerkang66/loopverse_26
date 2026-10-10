'use client';

import { useMemo } from 'react';
import { ShieldX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RESOURCE_LABEL } from '@/domain/constants';
import { RESOURCE_KEYS, type InfeasibilityCertificate, type ResourceKey, type Scenario } from '@/domain/types';
import { evaluateAll } from '@/engine/optimizer';
import { constraintsOf } from '@/engine/policy';
import { capOf } from '@/engine/resources';
import { Vec, ModeChips, Pill } from './bits';
import { useAres } from '@/client/store';
import { Button } from '@/components/ui/button';

/** Minimum achievable demand per resource among combinations the policy allows (ignoring resources). */
function floors(sc: Scenario, cert: InfeasibilityCertificate): { key: ResourceKey; min: number; cap: number }[] {
  const constraints = constraintsOf(sc);
  const allowed = evaluateAll(constraints, cert.policyEvaluated).filter((e) => !e.violations.some((v) => v !== 'RESOURCES'));
  const cap = capOf(sc.pool, sc.reserveRequirements);
  return RESOURCE_KEYS.map((key) => ({ key, min: allowed.length ? Math.min(...allowed.map((e) => e.totals[key])) : 0, cap: cap[key] }));
}

export function CertificateCard({ cert, sc, compact = false }: { cert: InfeasibilityCertificate; sc: Scenario | null; compact?: boolean }) {
  const bars = useMemo(() => (sc ? floors(sc, cert) : []), [sc, cert]);
  const openDialog = useAres((s) => s.openDialog);
  const setUi = useAres((s) => s.setUi);
  const readOnly = useAres((s) => s.readOnly);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-danger/40 bg-danger/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="danger" icon={<ShieldX className="size-3" />}>
          PROVEN INFEASIBLE
        </Pill>
        <span className="text-sm">
          Exhaustive search of <span className="num">{cert.combinationsChecked}</span> combinations under risk ≤ <span className="num">{cert.policyEvaluated.riskLimit}</span>, ≤{' '}
          <span className="num">{cert.policyEvaluated.maxSacrifices}</span> Sacrifice{cert.policyEvaluated.crisisOverride ? ' (Crisis Override)' : ''}.
        </span>
      </div>
      {bars.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="panel-title">Minimum achievable demand vs available</span>
          {bars.map((b) => {
            const scale = Math.max(b.min, b.cap, 1);
            const blocking = b.min > b.cap;
            return (
              <div key={b.key} className="grid grid-cols-[80px_1fr_110px] items-center gap-2 text-xs">
                <span className="text-muted-foreground">{RESOURCE_LABEL[b.key].name}</span>
                <div className="relative h-2.5 rounded-sm bg-panel-2 ring-1 ring-border">
                  <div className={cn('absolute inset-y-0 left-0 rounded-sm', blocking ? 'bg-danger' : 'bg-success/60')} style={{ width: `${(Math.min(b.min, b.cap) / scale) * 100}%` }} />
                  {blocking && <div className="hatch-danger absolute inset-y-0" style={{ left: `${(b.cap / scale) * 100}%`, width: `${((b.min - b.cap) / scale) * 100}%` }} />}
                  <div className="absolute -inset-y-0.5 w-0.5 bg-foreground" style={{ left: `${(b.cap / scale) * 100}%` }} />
                </div>
                <span className={cn('num text-right', blocking && 'font-semibold text-danger')}>
                  min {b.min} / {b.cap}
                  {blocking ? ` (+${b.min - b.cap})` : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <ul className="flex flex-col gap-1 text-sm">
        {cert.blocking.map((b, i) => (
          <li key={i}>
            <span className="font-medium text-danger">{b.constraint}:</span> {b.detail}
          </li>
        ))}
      </ul>
      {!compact && cert.closest.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="panel-title">Closest combinations</span>
          {cert.closest.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
              <ModeChips selections={c.selections} />
              <span className="text-muted-foreground">short</span>
              <Vec v={c.shortfall} className="text-danger" />
              <span className="num text-muted-foreground">
                risk {c.risk} · {c.sacrifices} sacrifice(s) · {c.policy}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <span className="panel-title">What would fix it</span>
        {cert.requests.map((r, i) => (
          <p key={i} className={cn('text-sm', i === 0 && 'font-semibold text-amber')}>
            {r}
          </p>
        ))}
        {!compact &&
          cert.policyAlternatives.map((p, i) => (
            <p key={i} className="text-xs text-muted-foreground">
              {p.feasible ? '✓' : '✗'} {p.change}: {p.detail}
            </p>
          ))}
        {!compact && !readOnly && cert.closest[0] && (
          <div className="pt-2">
            <Button
              size="sm"
              onClick={() => {
                const closest = cert.closest[0];
                if (!closest) return;
                const deltas = Object.fromEntries(
                  RESOURCE_KEYS.filter((k) => closest.shortfall[k] > 0).map((k) => [k, closest.shortfall[k]]),
                );
                setUi({ injectPreset: { tab: 'manual', manualDeltas: deltas, title: 'Emergency resupply' } });
                openDialog('inject');
              }}
            >
              Simulate resupply
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
