'use client';

import { useAres, type RightTab } from '@/client/store';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ModeBoard } from './panels/mode-board';
import { ValidationPanel } from './panels/validation-panel';
import { HistoryPanel } from './panels/history-panel';
import { FeasibilityPanel } from './panels/feasibility-panel';
import { CompliancePanel } from './panels/compliance-panel';
import { LedgerPanel } from './panels/ledger-panel';
import { AnalyticsPanel } from './panels/analytics-panel';

const TABS: { id: RightTab; label: string; render: () => React.ReactNode }[] = [
  { id: 'board', label: 'Mode Board', render: () => <ModeBoard /> },
  { id: 'validation', label: 'Validation', render: () => <ValidationPanel /> },
  { id: 'history', label: 'History', render: () => <HistoryPanel /> },
  { id: 'feasibility', label: 'Feasibility', render: () => <FeasibilityPanel /> },
  { id: 'compliance', label: 'Compliance', render: () => <CompliancePanel /> },
  { id: 'ledger', label: 'Ledger', render: () => <LedgerPanel /> },
  { id: 'analytics', label: 'Analytics', render: () => <AnalyticsPanel /> },
];

export function RightPanel({ only }: { only?: RightTab[] }) {
  const tab = useAres((s) => s.ui.rightTab);
  const compliance = useAres((s) => s.state?.compliance);
  const setUi = useAres((s) => s.setUi);
  const tabs = only ? TABS.filter((t) => only.includes(t.id)) : TABS;
  const value = tabs.some((t) => t.id === tab) ? tab : tabs[0]!.id;
  return (
    <Tabs value={value} onValueChange={(v) => setUi({ rightTab: v as RightTab })} className="flex h-full min-h-0 flex-col gap-2">
      <TabsList className="flex w-full flex-wrap justify-start gap-0.5 bg-panel p-1 group-data-horizontal/tabs:h-auto">
        {tabs.map((t) => (
          <TabsTrigger key={t.id} value={t.id} className="h-7 flex-none px-2 text-xs">
            {t.label}
            {t.id === 'compliance' && compliance && (
              <span className={`num ml-1 text-[10px] ${compliance.items.some((i) => i.status === 'FAIL') ? 'text-danger' : 'text-success'}`}>
                {compliance.passed}/{compliance.applicable}
              </span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent key={t.id} value={t.id} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pr-1">
          {value === t.id && t.render()}
        </TabsContent>
      ))}
    </Tabs>
  );
}
