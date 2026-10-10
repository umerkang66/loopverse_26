'use client';

import { Check, CircleDashed, Database, Minus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ComplianceItem } from '@/domain/types';
import { useAres } from '@/client/store';
import { Empty } from '../bits';

const GROUPS: { scope: ComplianceItem['scope']; title: string }[] = [
  { scope: 'BASELINE', title: 'Baseline negotiation' },
  { scope: 'EVENT', title: 'Post-event recovery' },
  { scope: 'SYSTEM', title: 'System' },
];

const STATUS = {
  PASS: { icon: Check, cls: 'text-success', word: 'PASS' },
  FAIL: { icon: X, cls: 'text-danger', word: 'FAIL' },
  PENDING: { icon: CircleDashed, cls: 'text-amber', word: 'PENDING' },
  NA: { icon: Minus, cls: 'text-muted-foreground', word: 'N/A' },
} as const;

export function CompliancePanel() {
  const compliance = useAres((s) => s.state?.compliance);
  const highlight = useAres((s) => s.highlight);
  const setUi = useAres((s) => s.setUi);
  const openDialog = useAres((s) => s.openDialog);
  if (!compliance) return null;
  if (compliance.items.length === 0) return <Empty>Compliance is computed from the live run.</Empty>;
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-success/30 bg-success/5 p-2.5">
        <p className="text-sm">
          <span className="num text-lg font-semibold text-success">
            {compliance.passed}/{compliance.applicable}
          </span>{' '}
          requirements met for this session
        </p>
        <p className="text-[11px] text-muted-foreground">Computed from the recorded run (messages, plans, votes, database counts) — never edited by hand. Evidence chips jump to the exact messages.</p>
      </div>
      {GROUPS.map((g) => {
        const items = compliance.items.filter((i) => i.scope === g.scope);
        if (items.length === 0) return null;
        return (
          <section key={g.scope} className="flex flex-col gap-1.5">
            <h3 className="panel-title">{g.title}</h3>
            {items.map((item) => {
              const st = STATUS[item.status];
              const Icon = st.icon;
              return (
                <div key={item.id} className={cn('flex gap-2 rounded-md border px-2 py-1.5', item.status === 'FAIL' ? 'border-danger/40 bg-danger/5' : 'border-border bg-panel-2/60')}>
                  <Icon className={cn('mt-0.5 size-4 shrink-0', st.cls)} aria-hidden />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[13px]">
                      {item.label} <span className={cn('text-[10px] font-semibold', st.cls)}>{st.word}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">{item.detail}</span>
                    {(item.evidence.length > 0 || item.id === 'PERSISTED') && (
                      <span className="flex flex-wrap gap-1 pt-0.5">
                        {item.evidence.map((id) => (
                          <button key={id} type="button" onClick={() => highlight(id)} className="num rounded-[6px] border border-info/30 bg-info/5 px-1.5 text-[10px] text-info hover:bg-info/15">
                            {id}
                          </button>
                        ))}
                        {item.id === 'PERSISTED' && (
                          <button
                            type="button"
                            onClick={() => {
                              setUi({ settingsFocus: 'database' });
                              openDialog('settings');
                            }}
                            className="inline-flex items-center gap-1 rounded-[6px] border border-info/30 bg-info/5 px-1.5 text-[10px] text-info hover:bg-info/15"
                          >
                            <Database className="size-3" /> Database card
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
