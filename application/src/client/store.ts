'use client';

import { createContext, createElement, useContext, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { StreamEvent } from '@/domain/stream';
import type { ActorId, AgentId, CouncilMessage, MessageSource, MessageType, PublicState } from '@/domain/types';

export type RightTab = 'board' | 'validation' | 'history' | 'feasibility' | 'compliance' | 'ledger' | 'analytics';
export type DialogName = 'start' | 'inject' | 'reset' | 'settings' | 'help' | 'judgeCode' | 'search' | 'countersign';
export type Connection = 'connecting' | 'live' | 'reconnecting' | 'offline';

export interface Filters {
  scenarioId: 'ALL' | string;
  agents: ActorId[];
  types: MessageType[];
  sources: MessageSource[];
  q: string;
}

export const EMPTY_FILTERS: Filters = { scenarioId: 'ALL', agents: [], types: [], sources: [], q: '' };

export interface UiState {
  focusScenarioId: string | null; // null = follow the current scenario
  rightTab: RightTab;
  filters: Filters;
  selectedAgent: AgentId | null; // Agent Mind sheet
  selectedPlanVersion: number | null; // History detail
  compare: [number | null, number | null];
  showPlanInForce: boolean;
  presentation: boolean;
  autoScroll: boolean;
  highlightMessageId: string | null;
  highlightNonce: number;
  dialogs: Record<DialogName, boolean>;
  settingsFocus: 'database' | null;
  injectPreset: { tab: 'presets' | 'json' | 'manual'; manualDeltas?: Partial<Record<string, number>>; title?: string } | null;
}

export interface AresState {
  readOnly: boolean;
  state: PublicState | null;
  messages: CouncilMessage[];
  lastSeq: number;
  connection: Connection;
  ui: UiState;
  hydrate(state: PublicState, messages: CouncilMessage[]): void;
  mergeMessages(messages: CouncilMessage[]): void;
  onStreamEvent(evt: StreamEvent): void;
  setConnection(connection: Connection): void;
  setUi(patch: Partial<UiState>): void;
  setFilters(patch: Partial<Filters>): void;
  openDialog(name: DialogName, open?: boolean): void;
  highlight(messageId: string): void;
}

const initialUi = (): UiState => ({
  focusScenarioId: null,
  rightTab: 'board',
  filters: EMPTY_FILTERS,
  selectedAgent: null,
  selectedPlanVersion: null,
  compare: [null, null],
  showPlanInForce: false,
  presentation: false,
  autoScroll: true,
  highlightMessageId: null,
  highlightNonce: 0,
  dialogs: { start: false, inject: false, reset: false, settings: false, help: false, judgeCode: false, search: false, countersign: false },
  settingsFocus: null,
  injectPreset: null,
});

function merge(prev: CouncilMessage[], incoming: CouncilMessage[]): CouncilMessage[] {
  if (incoming.length === 0) return prev;
  const last = prev[prev.length - 1]?.seq ?? 0;
  const sorted = [...incoming].sort((a, b) => a.seq - b.seq);
  if (sorted[0]!.seq > last) return [...prev, ...sorted];
  const bySeq = new Map(prev.map((m) => [m.seq, m]));
  for (const m of sorted) bySeq.set(m.seq, m);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

export function createAresStore(init: { readOnly?: boolean; state?: PublicState | null; messages?: CouncilMessage[] } = {}): StoreApi<AresState> {
  const messages = init.messages ?? [];
  return createStore<AresState>()((set) => ({
    readOnly: init.readOnly ?? false,
    state: init.state ?? null,
    messages,
    lastSeq: messages[messages.length - 1]?.seq ?? 0,
    connection: init.readOnly ? 'live' : 'connecting',
    ui: initialUi(),
    hydrate: (state, msgs) => set({ state, messages: [...msgs].sort((a, b) => a.seq - b.seq), lastSeq: msgs.reduce((n, m) => Math.max(n, m.seq), 0) }),
    mergeMessages: (incoming) =>
      set((s) => {
        const next = merge(s.messages, incoming);
        return { messages: next, lastSeq: next[next.length - 1]?.seq ?? 0 };
      }),
    onStreamEvent: (evt) =>
      set((s) => {
        switch (evt.type) {
          case 'state.updated':
            return { state: evt.state };
          case 'message.created': {
            if (s.messages.some((m) => m.seq === evt.message.seq)) return {};
            const next = merge(s.messages, [evt.message]);
            return { messages: next, lastSeq: Math.max(s.lastSeq, evt.message.seq) };
          }
          case 'agent.status': {
            if (!s.state) return {};
            const agent = s.state.agents[evt.agentId];
            return { state: { ...s.state, agents: { ...s.state.agents, [evt.agentId]: { ...agent, status: evt.status } } } };
          }
          default:
            return {};
        }
      }),
    setConnection: (connection) => set({ connection }),
    setUi: (patch) => set((s) => ({ ui: { ...s.ui, ...patch } })),
    setFilters: (patch) => set((s) => ({ ui: { ...s.ui, filters: { ...s.ui.filters, ...patch } } })),
    openDialog: (name, open = true) => set((s) => ({ ui: { ...s.ui, dialogs: { ...s.ui.dialogs, [name]: open } } })),
    highlight: (messageId) => set((s) => ({ ui: { ...s.ui, highlightMessageId: messageId, highlightNonce: s.ui.highlightNonce + 1 } })),
  }));
}

const AresContext = createContext<StoreApi<AresState> | null>(null);

export function AresProvider({ store, children }: { store?: StoreApi<AresState>; children: ReactNode }) {
  const [value] = useState(() => store ?? createAresStore());
  return createElement(AresContext.Provider, { value }, children);
}

export function useAresApi(): StoreApi<AresState> {
  const store = useContext(AresContext);
  if (!store) throw new Error('useAres must be used inside <AresProvider>');
  return store;
}

/** Fine-grained subscription: return primitives or stable references (use useShallow for new objects). */
export function useAres<T>(selector: (s: AresState) => T): T {
  return useStore(useAresApi(), selector);
}
