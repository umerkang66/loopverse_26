'use client';

import { useCallback, useEffect, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { toast } from 'sonner';
import { AGENT_IDS, MODE_IDS, type AgentId } from '@/domain/types';
import { ACTOR_META } from '@/client/theme';
import { api, type FaultStatus } from '@/client/api';
import { useAres } from '@/client/store';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Pill } from '../bits';

const selectClass = 'h-8 rounded-md border border-input bg-transparent px-2 text-xs dark:bg-input/30';

function Fault({ title, what, children }: { title: string; what: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border bg-panel p-2.5">
      <span className="text-xs font-semibold">{title}</span>
      <p className="text-[11px] text-muted-foreground">{what}</p>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** Settings → Resilience Lab (bonus: graceful handling of communication failure and noisy messages). */
export function ResilienceLab() {
  const state = useAres((s) => s.state);
  const readOnly = useAres((s) => s.readOnly);
  const [status, setStatus] = useState<FaultStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [outageSec, setOutageSec] = useState(60);
  const [dbSec, setDbSec] = useState(60);
  const [corruptAgent, setCorruptAgent] = useState<AgentId>('MEDICAL');
  const [dropAgent, setDropAgent] = useState<AgentId>('FOOD');
  const [tamperMode, setTamperMode] = useState('M2');
  const [hitlBusy, setHitlBusy] = useState(false);

  const refresh = useCallback(() => void api.faultStatus().then(setStatus).catch(() => undefined), []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [refresh]);

  if (!state) return null;
  const started = state.scenarios.length > 0;
  const live = state.config.mode === 'live';
  const supabase = state.storage.driver === 'supabase';
  const off = readOnly || !started;

  const fire = async (key: string, body: Record<string, unknown>) => {
    setBusy(key);
    try {
      const res = await api.faults(body);
      setStatus(res.faults);
      toast.message(res.announced);
    } catch {
      // toast shown by the client
    } finally {
      setBusy(null);
    }
  };

  const toggleHitl = async (enabled: boolean) => {
    setHitlBusy(true);
    try {
      await api.setHitl(enabled);
      toast.success(`Human countersign ${enabled ? 'enabled' : 'disabled'}`);
    } catch {
      // toast shown
    } finally {
      setHitlBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-panel-2 p-3" aria-labelledby="resilience-lab">
      <h3 id="resilience-lab" className="panel-title flex items-center gap-1.5">
        <FlaskConical className="size-3.5" /> Resilience Lab
      </h3>
      <p className="text-xs text-muted-foreground">
        Every fault is announced in the transcript as <b>Fault injected by judge</b>. Nothing is hidden or faked: the system either absorbs it visibly or blocks it.
        {!live && ' Agents are in OFFLINE mode, so model faults have no effect; the validator faults still work.'}
      </p>
      {!started && <p className="text-xs text-amber">Start the crisis first: faults land in the running transcript.</p>}
      <div className="flex flex-wrap gap-1.5">
        {status?.llmOutageUntil && <Pill tone="danger">OpenAI outage active</Pill>}
        {status?.dbOutageUntil && <Pill tone="amber">DB outage active</Pill>}
        {status?.armedCorrupt.map((a) => (
          <Pill key={`c${a}`} tone="stale">
            corrupt armed: {a}
          </Pill>
        ))}
        {status?.armedDrop.map((a) => (
          <Pill key={`d${a}`} tone="stale">
            drop armed: {a}
          </Pill>
        ))}
      </div>

      <div className="grid gap-2">
        <Fault title="OpenAI outage" what="Every LLM call fails; agents continue on labeled FALLBACK. After the window the circuit breaker probes and “LLM restored” appears.">
          <select aria-label="Outage seconds" className={selectClass} value={outageSec} onChange={(e) => setOutageSec(Number(e.target.value))}>
            {[30, 60, 120].map((n) => (
              <option key={n} value={n}>
                {n} s
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" disabled={off || busy !== null} onClick={() => void fire('outage', { kind: 'OUTAGE', durationSec: outageSec })}>
            Start outage
          </Button>
        </Fault>

        <Fault title="Corrupt next output" what="Discards that agent's next model result as invalid JSON → one repair retry (attempts: 2).">
          <select aria-label="Agent to corrupt" className={selectClass} value={corruptAgent} onChange={(e) => setCorruptAgent(e.target.value as AgentId)}>
            {AGENT_IDS.map((a) => (
              <option key={a} value={a}>
                {ACTOR_META[a].callsign}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" disabled={off || busy !== null} onClick={() => void fire('corrupt', { kind: 'CORRUPT_NEXT_OUTPUT', agentId: corruptAgent })}>
            Corrupt
          </Button>
        </Fault>

        <Fault title="Drop next message" what="The agent's next completed turn is lost in transit and treated as a timeout → retried, or FALLBACK if the retry fails too.">
          <select aria-label="Agent to drop" className={selectClass} value={dropAgent} onChange={(e) => setDropAgent(e.target.value as AgentId)}>
            {AGENT_IDS.map((a) => (
              <option key={a} value={a}>
                {ACTOR_META[a].callsign}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" disabled={off || busy !== null} onClick={() => void fire('drop', { kind: 'DROP_NEXT_MESSAGE', agentId: dropAgent })}>
            Drop
          </Button>
        </Fault>

        <Fault title="Relay noise" what="Posts an unverified relay message telling everyone to ignore the validator. Agents must ignore it; no state changes.">
          <Button size="sm" variant="outline" disabled={off || busy !== null} onClick={() => void fire('noise', { kind: 'NOISE' })}>
            Inject noise
          </Button>
        </Fault>

        <Fault title="Commander bypass attempt" what="Asks the approval function to approve the current draft directly. The gate re-validates and refuses without PASS and four matching votes.">
          <Button size="sm" variant="outline" disabled={off || busy !== null} onClick={() => void fire('bypass', { kind: 'BYPASS_ATTEMPT' })}>
            Attempt bypass
          </Button>
        </Fault>

        <Fault title="Package tampering" what="Submits a counteroffer that claims a lower Power figure than the published package. PACKAGE_INTEGRITY must fail.">
          <select aria-label="Mode to tamper" className={selectClass} value={tamperMode} onChange={(e) => setTamperMode(e.target.value)}>
            {MODE_IDS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" disabled={off || busy !== null} onClick={() => void fire('tamper', { kind: 'TAMPER_PACKAGE', modeId: tamperMode })}>
            Tamper
          </Button>
        </Fault>

        <Fault title="Database outage" what="Supabase writes fail for the window. The local snapshot keeps writing, negotiation timing is unchanged, and the buffer flushes on recovery. Best demo: trigger it mid-event.">
          <select aria-label="Database outage seconds" className={selectClass} value={dbSec} onChange={(e) => setDbSec(Number(e.target.value))} disabled={!supabase}>
            {[30, 60, 120].map((n) => (
              <option key={n} value={n}>
                {n} s
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" disabled={off || !supabase || busy !== null} onClick={() => void fire('db', { kind: 'DB_OUTAGE', durationSec: dbSec })}>
            Cut the database
          </Button>
          {!supabase && <span className="text-[11px] text-muted-foreground">needs Supabase storage</span>}
        </Fault>
      </div>

      {!readOnly && (
        <div className="flex items-center gap-2 border-t pt-3">
          <Switch id="hitl" checked={state.config.hitl.enabled} disabled={hitlBusy} onCheckedChange={(v) => void toggleHitl(v)} />
          <Label htmlFor="hitl" className="text-xs">
            Human countersign when risk &gt; {state.config.hitl.riskThreshold}
          </Label>
        </div>
      )}
    </section>
  );
}
