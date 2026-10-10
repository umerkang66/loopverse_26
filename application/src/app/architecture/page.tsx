'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Copy, ExternalLink, Network, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

const MMD_SOURCE = `flowchart LR
  subgraph UI["Next.js 16 Dashboard (React 19)"]
    MC["Mission Control"]
    CT["Council Transcript"]
    MB["Mode Board"]
    VAL["Validation"]
    JC["Judge Controls"]
    XV["History · Feasibility · Compliance · Agent Mind · Resilience Lab · Search"]
  end
  subgraph API["Route handlers (Node runtime)"]
    ST["GET /api/state"]
    SSE["GET /api/stream (SSE)"]
    CTRL["POST /api/control/* (start, reset, resume, countersign, faults)"]
    EVT["POST /api/events/interpret + apply"]
    EXP["GET /api/export (JSON, CSV, evidence zip)"]
    SRCH["GET /api/search (all sessions)"]
    HLTH["GET /api/health (models, storage)"]
  end
  subgraph RT["AresRuntime singleton"]
    ORCH["Negotiation orchestrator: 7-phase rounds, min/max rounds, deadlines, approval gate"]
    STATE[("SessionState: scenarios, plans, votes, commitments, messages, agent states")]
    BUS[("Event bus + ring buffer")]
    GW["Agent gateway: timeout, repair retry, circuit breaker, fault injection"]
    FB["Rule-based fallback policies (labeled FALLBACK)"]
    subgraph AG["Five agents on OpenAI Agents SDK (separate instructions, sessions, state)"]
      CMD["ACTUAL · Commander (+ Event Intake)"]
      LS["HAVEN · Life Support"]
      MED["MERIDIAN · Medical"]
      FD["VERDANT · Food Production"]
      ENG["FORGE · Engineering"]
    end
    subgraph DET["Deterministic engine (pure TypeScript)"]
      V["Validator (10 checks)"]
      OPT["Optimizer (81 combinations)"]
      INF["Infeasibility certificate"]
      LED["Commitment ledger + review"]
      PV["Plan versioning + vote binding"]
      CMP["Compliance checker"]
    end
  end
  OAI[("OpenAI Responses API · gpt-5.6-terra · tracing")]
  SYNC["Write-behind sync: dirty rows → FK-ordered idempotent upserts, retries, status"]
  DB[("Supabase Postgres 17: ares_* tables · RLS on · service_role-only grants · full-text search")]
  SNAP[("Local snapshot data/INSTANCE/current.json: crash buffer + file-mode store")]
  JC --> CTRL --> ORCH
  JC --> EVT --> CMD
  ORCH --> GW --> AG --> OAI
  GW --> FB
  AG -- "read-only tools" --> DET
  ORCH --> DET
  ORCH --> STATE
  STATE -- "markDirty" --> SYNC -- "supabase-js + secret key" --> DB
  STATE -- "debounced" --> SNAP
  STATE --> BUS --> SSE --> UI
  ST --> UI
  EXP --> STATE
  EXP -- "archived sessions" --> DB
  SRCH -- "rpc ares_search_messages" --> DB
  HLTH --> SYNC`;

interface LegendItem {
  id: string;
  name: string;
  subsystem: string;
  codePath: string;
  description: string;
}

const LEGEND: LegendItem[] = [
  { id: 'MC', name: 'Mission Control', subsystem: 'UI', codePath: 'src/components/ares/mission-control.tsx', description: 'Real-time resource gauges, reserve requirements, risk meter, and 7-phase stepper' },
  { id: 'CT', name: 'Council Transcript', subsystem: 'UI', codePath: 'src/components/ares/transcript/transcript.tsx', description: 'Live SSE feed with typed cards (proposals, objections, counteroffers, votes, approvals)' },
  { id: 'MB', name: 'Mode Board', subsystem: 'UI', codePath: 'src/components/ares/panels/mode-board.tsx', description: 'Selected mode per department, consequence, risk, return commitments, and watermark stamps' },
  { id: 'VAL', name: 'Validation Panel', subsystem: 'UI', codePath: 'src/components/ares/panels/validation-panel.tsx', description: 'Independent deterministic validator verdict (PASS/FAIL across 10 rules)' },
  { id: 'JC', name: 'Judge Controls', subsystem: 'UI', codePath: 'src/components/ares/judge-controls.tsx', description: 'Resource entry, Start, Inject unseen events, Resume, Reset, and Exports' },
  { id: 'XV', name: 'Extended Views', subsystem: 'UI', codePath: 'src/components/ares/panels/', description: 'History diffs, 81-combination Feasibility heatmap, Compliance checklist, Agent Mind, Resilience Lab' },
  { id: 'ST', name: 'State API', subsystem: 'API', codePath: 'src/app/api/state/route.ts', description: 'GET /api/state: incremental state updates via sinceSeq query param' },
  { id: 'SSE', name: 'Stream API', subsystem: 'API', codePath: 'src/app/api/stream/route.ts', description: 'GET /api/stream: Server-Sent Events with gap recovery and 15s heartbeats' },
  { id: 'CTRL', name: 'Control API', subsystem: 'API', codePath: 'src/app/api/control/route.ts', description: 'POST endpoints for start, resume, reset, countersign, config, and fault injection' },
  { id: 'EVT', name: 'Event API', subsystem: 'API', codePath: 'src/app/api/events/interpret/route.ts', description: 'POST /api/events/interpret (hybrid LLM+parser) and /api/events/apply' },
  { id: 'EXP', name: 'Export API', subsystem: 'API', codePath: 'src/app/api/export/route.ts', description: 'JSON, CSV, and full evidence zip pack with sha256 manifest and DB parity' },
  { id: 'SRCH', name: 'Search API', subsystem: 'API', codePath: 'src/app/api/search/route.ts', description: 'Ranked full-text search across all sessions via Supabase RPC or local fallback' },
  { id: 'HLTH', name: 'Health API', subsystem: 'API', codePath: 'src/app/api/health/route.ts', description: 'Judge health probe with model latency checks, storage sync status, and deep row counts' },
  { id: 'ORCH', name: 'Negotiator Orchestrator', subsystem: 'Runtime', codePath: 'src/server/orchestrator/negotiation.ts', description: 'Manages 7-phase negotiation rounds, min/max round rules, deadlines, and approval gate' },
  { id: 'STATE', name: 'Session State', subsystem: 'Runtime', codePath: 'src/domain/types.ts', description: 'In-memory single-source-of-truth: scenarios, plans, votes, commitments, agent states' },
  { id: 'BUS', name: 'Event Bus', subsystem: 'Runtime', codePath: 'src/server/bus.ts', description: 'Pub/sub bus with 2000-item ring buffer for SSE broadcasting' },
  { id: 'GW', name: 'Agent Gateway', subsystem: 'Runtime', codePath: 'src/server/agents/gateway.ts', description: 'Executes turns with timeouts, repair retries, circuit breakers, and fault hooks' },
  { id: 'FB', name: 'Fallback Policies', subsystem: 'Runtime', codePath: 'src/server/agents/fallback/', description: 'Deterministic rule-based backup policies (always labeled source: FALLBACK)' },
  { id: 'CMD', name: 'ACTUAL (Commander)', subsystem: 'Agents', codePath: 'src/server/agents/commander.ts', description: 'Briefs the council, compiles consensus proposals, and manages event intake' },
  { id: 'LS', name: 'HAVEN (Life Support)', subsystem: 'Agents', codePath: 'src/server/agents/department.ts', description: 'Protects habitat survival, defends power and water allocations' },
  { id: 'MED', name: 'MERIDIAN (Medical)', subsystem: 'Agents', codePath: 'src/server/agents/department.ts', description: 'Tends crew injuries, defends oxygen allocations, prioritizes intensive care' },
  { id: 'FD', name: 'VERDANT (Food)', subsystem: 'Agents', codePath: 'src/server/agents/department.ts', description: 'Protects greenhouse crop cycles, manages high power and water needs' },
  { id: 'ENG', name: 'FORGE (Engineering)', subsystem: 'Agents', codePath: 'src/server/agents/department.ts', description: 'Maintains critical infrastructure, defends robot time and bandwidth needs' },
  { id: 'V', name: 'Validator (10 checks)', subsystem: 'Deterministic Engine', codePath: 'src/engine/validator.ts', description: 'Checks modes, package integrity, forbidden modes, resources, risk, sacrifices, returns, currency' },
  { id: 'OPT', name: 'Optimizer (81 combos)', subsystem: 'Deterministic Engine', codePath: 'src/engine/optimizer.ts', description: 'Exhaustive combination evaluator across baseline and override policies' },
  { id: 'INF', name: 'Infeasibility Engine', subsystem: 'Deterministic Engine', codePath: 'src/engine/infeasibility.ts', description: 'Generates mathematical proof certificates with exact shortfall vectors and requests' },
  { id: 'LED', name: 'Commitment Ledger', subsystem: 'Deterministic Engine', codePath: 'src/engine/commitments.ts', description: 'Tracks return commitments across cycles with DUE/FULFILLED/BREACHED rules' },
  { id: 'PV', name: 'Plan Versioning', subsystem: 'Deterministic Engine', codePath: 'src/engine/plans.ts', description: 'Hash-based plan versioning that strictly invalidates old ballots on any plan change' },
  { id: 'CMP', name: 'Compliance Engine', subsystem: 'Deterministic Engine', codePath: 'src/engine/compliance.ts', description: 'Computes 15 live checklist items ensuring all challenge requirements are honored' },
  { id: 'OAI', name: 'OpenAI Responses API', subsystem: 'External', codePath: 'https://platform.openai.com', description: 'gpt-5.6-terra with low reasoning effort, structured outputs, and platform tracing' },
  { id: 'SYNC', name: 'Write-Behind Sync', subsystem: 'Storage', codePath: 'src/server/db/sync.ts', description: 'Non-blocking worker syncing dirty state to Supabase via idempotent FK-safe upserts' },
  { id: 'DB', name: 'Supabase Postgres 17', subsystem: 'Storage', codePath: 'supabase/migrations/', description: '11 ares_* tables, RLS enabled, service_role-only grants, GIN full-text index' },
  { id: 'SNAP', name: 'Local Snapshot', subsystem: 'Storage', codePath: 'src/server/store/snapshot.ts', description: 'Crash-safe local JSON buffer in data/INSTANCE/current.json' },
];

export default function ArchitecturePage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let active = true;
    async function loadMermaid() {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          themeVariables: {
            darkMode: true,
            background: '#07090C',
            mainBkg: '#131820',
            textColor: '#E6EDF3',
            lineColor: '#58A6FF',
            primaryColor: '#DC3545',
            primaryTextColor: '#FFFFFF',
            primaryBorderColor: '#FF6B6B',
            secondaryColor: '#1E2630',
            secondaryTextColor: '#C9D1D9',
            tertiaryColor: '#0E1318',
            tertiaryBorderColor: '#30363D',
          },
        });
        const { svg } = await mermaid.render('ares-arch-svg', MMD_SOURCE);
        if (active && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setRendered(true);
        }
      } catch (err) {
        console.error('Failed to render mermaid diagram', err);
      }
    }
    loadMermaid();
    return () => {
      active = false;
    };
  }, []);

  const copyMmd = () => {
    navigator.clipboard.writeText(MMD_SOURCE);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const filtered = LEGEND.filter(
    (item) =>
      item.name.toLowerCase().includes(filter.toLowerCase()) ||
      item.subsystem.toLowerCase().includes(filter.toLowerCase()) ||
      item.codePath.toLowerCase().includes(filter.toLowerCase()) ||
      item.id.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur px-4 py-3">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-4" /> Back to Mission Control
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="font-semibold text-foreground">Architecture</span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/health" className="rounded-md border bg-panel px-3 py-1.5 text-xs font-medium hover:bg-panel-2">
              System Health →
            </Link>
            <Button size="sm" variant="outline" onClick={copyMmd} className="gap-1.5">
              {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
              {copied ? 'Copied .mmd' : 'Copy Mermaid Source'}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 flex flex-col gap-8">
        {/* Title */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Network className="size-6 text-mars" />
            <h1 className="text-2xl font-bold tracking-tight">ARES ACCORD — System Architecture</h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-3xl leading-relaxed">
            Five autonomous agents orchestrated under a deterministic TypeScript validation gate. The system uses a write-behind non-blocking sync to Supabase Postgres 17 with an instant crash-safe local file store, guaranteeing that database interruptions never pause negotiation turns.
          </p>
        </section>

        {/* Diagram Card */}
        <section className="flex flex-col gap-3 rounded-xl border bg-panel p-4 shadow-lg">
          <div className="flex items-center justify-between border-b pb-3">
            <div className="flex items-center gap-2">
              <span className="inline-block size-2.5 rounded-full bg-success" />
              <h2 className="font-semibold text-sm">Interactive System Diagram</h2>
            </div>
            <span className="text-xs text-muted-foreground font-mono">docs/architecture.mmd</span>
          </div>

          <div
            ref={containerRef}
            className="flex items-center justify-center overflow-x-auto rounded-lg bg-[#07090C] p-6 min-h-[460px]"
          >
            {!rendered && (
              <div className="flex flex-col items-center gap-2 text-muted-foreground text-sm animate-pulse">
                <Sparkles className="size-5 text-mars" />
                Rendering Mermaid Architecture Diagram…
              </div>
            )}
          </div>
        </section>

        {/* Architecture Highlights */}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-lg border bg-panel p-4 flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-mars font-semibold text-sm">
              <ShieldCheck className="size-4" /> Deterministic Gate
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              No LLM evaluates feasibility or validates claims. 10 independent algorithmic checks govern approval, ensuring immutable package values and strict mathematical guarantees.
            </p>
          </div>
          <div className="rounded-lg border bg-panel p-4 flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-info font-semibold text-sm">
              <Network className="size-4" /> Non-blocking Write-behind
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              State transitions occur in-memory at microsecond speed. An asynchronous worker buffers dirty rows to Supabase Postgres, shrugging off database outages during live renegotiations.
            </p>
          </div>
          <div className="rounded-lg border bg-panel p-4 flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-success font-semibold text-sm">
              <Sparkles className="size-4" /> Agent Memory & Trust
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Commitment promises persist across crisis scenarios. Kept promises build trust (+0.2), while avoidable breaches destroy it (-0.4), visible in each agent’s prompt packet.
            </p>
          </div>
        </section>

        {/* Legend Table */}
        <section className="flex flex-col gap-3 rounded-xl border bg-panel p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3">
            <div>
              <h3 className="font-semibold text-base">Architecture Legend & Code Mapping</h3>
              <p className="text-xs text-muted-foreground">Every diagram node strictly matches an implemented file path in the repository.</p>
            </div>
            <input
              type="text"
              placeholder="Filter nodes or files…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="rounded-md border bg-panel-2 px-3 py-1 text-xs max-w-xs"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="py-2 pr-3 font-semibold w-16">Node</th>
                  <th className="py-2 pr-4 font-semibold w-40">Component</th>
                  <th className="py-2 pr-4 font-semibold w-32">Subsystem</th>
                  <th className="py-2 pr-4 font-semibold font-mono">Code Path</th>
                  <th className="py-2 font-semibold">Responsibility</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {filtered.map((item) => (
                  <tr key={item.id} className="hover:bg-panel-2/60 transition-colors">
                    <td className="py-2.5 pr-3 font-mono font-bold text-mars">{item.id}</td>
                    <td className="py-2.5 pr-4 font-medium text-foreground">{item.name}</td>
                    <td className="py-2.5 pr-4">
                      <span className="rounded bg-panel-2 px-2 py-0.5 text-[10px] text-muted-foreground border">
                        {item.subsystem}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-[11px] text-info">
                      {item.codePath}
                    </td>
                    <td className="py-2.5 text-muted-foreground leading-relaxed">{item.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
