'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { StreamEvent } from '@/domain/stream';
import { api } from './api';
import { EMPTY_FILTERS, useAresApi } from './store';

const TOAST = { info: toast.info, success: toast.success, warning: toast.warning, error: toast.error } as const;

/**
 * Hydrates from GET /api/state and follows GET /api/stream (SSE). EventSource resends Last-Event-ID on reconnect,
 * so the server replays what was missed; any gap in message seq triggers a refetch. Strict-Mode safe.
 */
export function useAresStream(enabled = true): { reconnect: () => void } {
  const store = useAresApi();
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const get = store.getState;
    let disposed = false;
    let syncing = false;
    let offlineTimer: ReturnType<typeof setTimeout> | null = null;

    const armOffline = () => {
      offlineTimer ??= setTimeout(() => {
        if (!disposed) get().setConnection('offline');
      }, 30_000);
    };
    const clearOffline = () => {
      if (offlineTimer) clearTimeout(offlineTimer);
      offlineTimer = null;
    };
    const resync = async () => {
      if (syncing) return;
      syncing = true;
      try {
        const res = await api.state();
        if (!disposed) get().hydrate(res.state, res.messages);
      } catch {
        // the stream reconnects on its own; the next open resyncs
      } finally {
        syncing = false;
      }
    };

    get().setConnection('connecting');
    armOffline();
    const es = new EventSource('/api/stream');
    es.onopen = () => {
      clearOffline();
      get().setConnection('live');
      void resync();
    };
    es.onerror = () => {
      if (disposed) return;
      get().setConnection('reconnecting');
      armOffline();
    };

    const on = <T extends StreamEvent['type']>(type: T, handler: (evt: Extract<StreamEvent, { type: T }>) => void) =>
      es.addEventListener(type, (e) => {
        if (disposed) return;
        handler(JSON.parse((e as MessageEvent<string>).data) as Extract<StreamEvent, { type: T }>);
      });

    on('state.updated', (evt) => get().onStreamEvent(evt));
    on('message.created', (evt) => {
      const { lastSeq } = get();
      if (evt.message.seq <= lastSeq) return;
      get().onStreamEvent(evt);
      if (lastSeq > 0 && evt.message.seq > lastSeq + 1) void resync();
      if (evt.message.subtype === 'VOTES_CLEARED') toast.info(`Votes cleared — ${evt.message.summary}`);
    });
    on('agent.status', (evt) => get().onStreamEvent(evt));
    on('toast', (evt) => TOAST[evt.level](evt.text));
    on('session.reset', () => {
      get().setUi({ filters: EMPTY_FILTERS, focusScenarioId: null, selectedPlanVersion: null, highlightMessageId: null, selectedAgent: null, compare: [null, null] });
      void resync();
    });

    return () => {
      disposed = true;
      clearOffline();
      es.close();
    };
  }, [store, enabled, nonce]);

  return { reconnect: () => setNonce((n) => n + 1) };
}
