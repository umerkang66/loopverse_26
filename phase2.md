# PHASE 2 — Mission Control Dashboard (the judge-facing UI)

> **ARES ACCORD** · Phase 2 of 3 · Prerequisite: Phase 1 is complete (`phase1.md` §13 Definition of Done is all checked).
> Before coding, read `phase1.md` §1 (mission brief), §5.1 (types), §7.3 (stream events), and §10 (API).

---

## 0. Goal, ground rules, time budget

**Goal:** turn the Phase 1 engine into a dashboard where a technical judge, with **no instructions and without reading code**, can enter resources, start the crisis, follow every proposal, objection, counteroffer, commitment, vote, and approval live, see the plan, resource pool, and validator verdict at all times, inject an event, watch the council recover, and export everything.

The PDF is explicit: *"judges are technical experts and will evaluate the system through the dashboard, not the source code."* The UI is the scoring surface, so build it with that care.

Ground rules:
1. **Use the PDF's own vocabulary as section titles.** Name the panels exactly **Mission Control**, **Council Transcript**, **Mode Board**, **Validation**, and **Judge Controls**, so the judge can map the spec to the screen instantly.
2. **Numbers first.** Every claim is shown with its numbers (`P79/79 W50/52 …`), in tabular monospace digits.
3. **Never ambiguous status.** Each status uses color + icon + word (PASS ✓, FAIL ✗, STALE, INVALID, FALLBACK…). Nothing relies on color alone.
4. **Live, not refreshed.** Every change arrives over SSE (`/api/stream`) and animates in. There is no polling and no reload button.
5. **The UI never computes authority.** Validation results, plan versions, and votes come from the server. The client may use the pure `src/engine` functions only for *previews* (feasibility matrix, diffs, formatting).
6. No manual agent messages. Judges have controls, not a chat box.

Time budget: about **5–6 hours** (PDF hours 12–16).

---

## 1. Setup

```bash
cd application
npx shadcn@latest init          # choose the Radix base; neutral base color (we override tokens). Check `--help` for current flags.
npx shadcn@latest add button card badge tabs dialog sheet tooltip hover-card scroll-area separator input label \
  textarea select switch dropdown-menu popover accordion collapsible table toggle-group alert progress skeleton sonner
npm install zustand motion lucide-react
npm install recharts            # optional (analytics tab)
```

- `src/app/layout.tsx`: `<html lang="en" className="dark">`, Geist Sans and Geist Mono via `next/font/google` (already in the template), `<Toaster richColors position="bottom-right" />` from sonner, and a `<TooltipProvider>` wrapper.
- Keep `/dev` (Phase 1 debug console) but hide it from navigation. Only show the link when `?debug=1`.

---

## 2. Visual design system ("Mars Ops")

A dark mission-control look: deep blue-black panels, Mars-orange accents, crisp monospace numerals, and restrained glow. Calm by default; color appears only where it carries meaning.

### 2.1 Tokens (`src/app/globals.css`, Tailwind v4 CSS-first)

Define them on `.dark` (override shadcn's variables) and expose custom ones through `@theme inline`:

| Token | Value | Use |
|---|---|---|
| `--background` | `#07090C` | page |
| `--panel` | `#0E1217` | cards and panels |
| `--panel-2` | `#131820` | nested surfaces, inputs |
| `--border` | `#1E2630` | hairlines |
| `--foreground` | `#E6EDF3` | text |
| `--muted-foreground` | `#8A97A8` | secondary text |
| `--mars` | `#E4572E` | primary accent, primary buttons, brand |
| `--amber` | `#F2A541` | warnings, Crisis Override, RESTRICTED, FALLBACK |
| `--success` | `#34D399` | PASS, ACCEPT, APPROVED, STANDARD |
| `--danger` | `#F43F5E` | FAIL, REJECT, INVALID, SACRIFICE, overage |
| `--info` | `#60A5FA` | system, links, HUMAN |
| `--stale` | `#9CA3AF` | STALE, superseded |
| Agents | ACTUAL `#A78BFA` · HAVEN `#22D3EE` · MERIDIAN `#FB7185` · VERDANT `#A3E635` · FORGE `#F59E0B` | emblems, left borders, gauge segments |

- Tier pills: STANDARD (success), RESTRICTED (amber), SACRIFICE (danger), always with the text label.
- Numbers: `font-mono tabular-nums`. IDs and hashes: mono, muted.
- Radius 10 px for panels, 6 px for chips. 1 px borders. No heavy shadows; active elements get a 1 px inner ring in their semantic color at 40 % opacity.
- Background: a very subtle radial Mars glow in the top-right (`radial-gradient(… rgba(228,87,46,.08) …)`) plus a 1 px grid at 3 % opacity on the header only.
- Agent emblems: a circle in the agent color with a lucide icon: ACTUAL `ShieldHalf`, HAVEN `Wind`, MERIDIAN `HeartPulse`, VERDANT `Sprout`, FORGE `Wrench`. Always paired with the callsign text.
- Message-type icons: BRIEFING `Megaphone`, PROPOSAL `FileText`, OBJECTION `AlertTriangle`, COUNTEROFFER `Repeat2`, COMMITMENT `Handshake`, PLAN_DRAFT `ClipboardList`, VALIDATION `ShieldCheck`/`ShieldX`, VOTE `Vote`, APPROVAL `Stamp`, DECISION `Gavel`, EVENT `Zap`, SYSTEM `Info`.

### 2.2 Motion (`motion/react`), always respecting `prefers-reduced-motion`
- New message: fade + 8 px rise, 180 ms. A new turn group gets a 1.2 s left-border glow in the agent color.
- Gauges and risk meter: width/position transitions, 300 ms ease-out.
- Vote lights: flip-in (rotateX) when a ballot lands. When **votes are cleared**, all four lights dim together with a short "votes cleared" toast.
- Plan version chip: scale bump (1 → 1.12 → 1) when the version increments.
- Outcome banners: APPROVED scales in with a soft success glow; INFEASIBLE/DEADLOCK slide down. No confetti; keep it mission-grade.
- Thinking indicator: three dots pulsing in the agent color.

### 2.3 Typography scale
Base 14 px; panel titles 12 px uppercase tracking-wider muted (`MISSION CONTROL`); key numbers 20–28 px mono. **Presentation mode** (a toggle) sets the root font-size to 112.5 % and hides secondary metadata, for projectors and the demo video.

---

## 3. Information architecture and layout

### 3.1 Main layout (≥ 1440 px)

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◉ ARES ACCORD · Colony Council   [S0 Baseline ✓][S1 Solar aftershock ●]   ● NEGOTIATING  R2/5      │ ← StatusBar (sticky)
│   Plan v5 #3fa9c2 · VOTING 2/4 · ⏱ 02:14 · LIVE gpt-5.6-terra · DB Supabase ✓ · ● live · [⚙][?] │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ MISSION CONTROL                                                          │ JUDGE CONTROLS          │
│ ⚡ EVENT S1 · Solar aftershock — Power −4 (79→75) · CRISIS OVERRIDE ACTIVE│ [▶ Start] [⚡ Inject]   │
│ Power  ▕█████████████▏ 75/75 · reserve 0   Water ▕███████████░▏ 49/52 · 3│ [↻ Resume] [⟲ Reset]   │
│ Oxygen ▕████████████░▏ 56/59 · 3            Robot ▕█████████░░░▏ 22/26 · 4│ [⤓ Export ▾]           │
│ Bandw. ▕██████████░░▏ 15/17 · 2   Risk ▕▮▮▮▮▮▮▮▮▮▮▏ 28/28   Sacrifice ●● 2/2                     │
│ Protocol ①Publish ②Request ③Conflicts ④Negotiate [⑤Draft] ⑥Validate&Vote ⑦Approve   Rounds ●●○○○ │
├────────────────┬──────────────────────────────────────────────────┬─────────────────────────────┤
│ COUNCIL        │ COUNCIL TRANSCRIPT    [All scenarios ▾][agents][types][🔎]│ [Mode Board][Validation]    │
│ ◆ ACTUAL  Cmdr │ ═══ S1 · Solar aftershock · started 12:04:10 ═══ │ [History][Feasibility]      │
│   drafting…    │ ── Round 2 · plan v5 ─────────────────────────── │ [Compliance][Ledger]        │
│ ◆ HAVEN   LS   │ ┃ FORGE · Engineering  COUNTEROFFER R2 v4 LLM 2.1s│ ┌ Plan v5 · VOTING 2/4 ───┐ │
│   L3 · ACCEPT  │ ┃ "…"  L2 M2 F3 E3 → P74/75 W47/49 … PASS*      │ │ HAVEN   L3 SACRIFICE 9  │ │
│ ◆ MERIDIAN Med │ ┃ VALIDATOR · VALIDATION v5 ✓ PASS 8/8           │ │ MERIDIAN M2 RESTRICTED 5│ │
│   M2 · ✓       │ ┃ VERDANT · VOTE ✓ ACCEPT v5 "…"                 │ │ VERDANT F2 RESTRICTED 5 │ │
│ ◆ VERDANT Food │ ┃ …                                              │ │ FORGE   E3 SACRIFICE 9  │ │
│ ◆ FORGE   Eng  │ ┃ ● MERIDIAN is voting…                          │ │ Returns ✓✓ / ✓✓ Votes ●●○○│ │
└────────────────┴──────────────────────────────────────────────────┴─────────────────────────────┘
```

Columns: Council roster **300 px** | Transcript **flex** | Right panel **460 px**. The StatusBar and Mission Control are sticky; the three columns scroll independently.

### 3.2 Responsive behavior
- **1280–1439 px:** roster collapses to a 76 px column of emblems with status rings (tooltips show details); right panel 420 px.
- **1024–1279 px:** two columns (Transcript | Right panel); the roster becomes a horizontal strip under Mission Control.
- **< 1024 px:** a single column with top tabs `Transcript · Board · Validation · More`. Mission Control gauges stack two per row.
- Test at **1280×720** (laptop demo) and **1920×1080** (video).

### 3.3 Idle state (before Start): "Council standing by"
The center column shows a hero card:
- Crisis narrative (from the scenario JSON) and the 42 crew / 6 injured stats.
- **"Five agents loaded — separate goals, state, and private sessions"**: five mini profile cards (emblem, callsign, name, mission, main concern), each opening the Agent Mind sheet. This visibly satisfies *"Five named agents load with separate goals and state"* before anything runs.
- **Resource entry** (the judge "enters the available resources"): five number inputs prefilled with 79/52/59/26/17, a "Reset to guide values" link, and validation (integers 0–999). A live mini feasibility preview below the inputs (computed client-side with `src/engine/optimizer`) reads: *"With these resources: 2 feasible plans under baseline limits"*.
- A big **Start crisis** button (Mars color).
- Advanced (collapsible): max rounds and deadline overrides (passed to `/api/control/start`).

---

## 4. Client data layer (`src/client/*`)

### 4.1 `api.ts`
Typed fetchers for every Phase 1 route. Mutating calls add `x-judge-code` from `localStorage['ares.judgeCode']` if present. On 401, open a small "Judge access code" dialog. The server enforces the code whenever `JUDGE_ACCESS_CODE` is set (Phase 1 §10); hosted demos set it in Phase 3. Errors surface as sonner toasts with the server's `{ error }`.

### 4.2 `store.ts` (zustand)
```ts
interface AresStore {
  state: PublicState | null;              // replaced on every state.updated
  messages: CouncilMessage[];             // append-only, deduped by seq, sorted by seq
  lastSeq: number;
  connection: 'connecting' | 'live' | 'reconnecting' | 'offline';
  ui: {
    focusScenarioId: string | null;       // null = follow the current scenario
    rightTab: 'board' | 'validation' | 'history' | 'feasibility' | 'compliance' | 'ledger' | 'analytics';
    filters: { scenarioId: 'ALL' | string; agents: AgentId[]; types: MessageType[]; sources: MessageSource[]; q: string };
    selectedAgent: AgentId | null;        // Agent Mind sheet
    selectedPlanVersion: number | null;   // History detail
    presentation: boolean; autoScroll: boolean; highlightMessageId: string | null;
  };
  hydrate(state: PublicState, messages: CouncilMessage[]): void;
  onStreamEvent(evt: StreamEvent): void;
  setUi(patch: Partial<AresStore['ui']>): void;
}
```
Keep `messages` and `state` in separate slices, and use fine-grained selectors (`useAres(s => s.state?.run.phase)`), so a `state.updated` doesn't re-render the transcript list.

### 4.3 `use-ares-stream.ts`
1. On mount: `GET /api/state` → `hydrate`.
2. Open `new EventSource('/api/stream')`. The browser resends the last `id:` as `Last-Event-ID` on reconnect, so the server replays what was missed.
3. Handle `state.updated`, `message.created` (ignore if `seq ≤ lastSeq`; if `seq > lastSeq + 1`, refetch `/api/state` to close the gap), `agent.status`, `toast` (→ sonner), and `session.reset` (→ refetch everything and clear UI filters).
4. `onerror` → `connection = 'reconnecting'`. On `open` → `'live'`. After 30 s without `open` → `'offline'`, with a banner and a manual "Reconnect" button.
5. Clean up in the effect return, since React Strict Mode mounts twice in dev.

### 4.4 `selectors.ts` (pure, memoized)
- `currentScenario`, `focusScenario` (focus or current), `planInForce`, `focusDraft` (latest plan in the focus scenario).
- `boardPlan` = `focusDraft ?? planInForce`, with a toggle "show plan in force".
- `latestReport(plan)`, `votesFor(plan)` (latest ballot per department bound to version + hash), and `clearedVotes(plan)` (ballots on superseded versions).
- `deptView(dept)` = `{ selectedMode, requestedMode, stance, returns (commitments where beneficiary = dept, included in boardPlan), conflicts, vote, objectionsAgainst }`.
  - Conflicts are derived as: (a) for each overflowing resource, this dept's share (e.g., *"contributes 27 to Power overflow (+4)"*); (b) RETURN_AGREEMENT failures for this dept; (c) forbidden mode; (d) objections targeting this dept in the latest round.
- `resourceRows(plan, scenario)` = per resource: `{ available, used, reserve, over, segments: [{dept, value}], requestedUsed }`.
- `phaseStep(run)` maps the phase and round to the PDF's 7 protocol steps (§5.1).
- `modeIndicator(state, messages)` → `LIVE · <model>` | `OFFLINE · rule-based` | `DEGRADED · fallback active` (an unrecovered `FALLBACK_NOTICE` in the last 60 s, or an open circuit).
- `storageBadge(state.storage)` → a label, tone, and tooltip for the database status:
  - `SYNCED` → **"DB · Supabase ✓"** (success)
  - `SYNCING` → **"DB · syncing (n)"** (info)
  - `DEGRADED` → **"DB · retrying — n pending, safe locally"** (amber)
  - `ERROR` → **"DB · error: <hint>"** (danger)
  - `LOCAL_ONLY` → **"DB · local file store"** (muted)

  The tooltip shows the project host, instance id, last sync time, and rows written. Never a key.

---

## 5. Required views (exact names)

### 5.1 MISSION CONTROL (sticky strip under the StatusBar)
*PDF: current event, available resources, used resources, reserve, round, and plan status.*

- **Event banner:** for S0, "BASELINE — Micrometeorite storm (42 crew, 6 injured)". For events: ⚡ name, description, effects summary (*"Power −30 % (79→55) · 6 h"*), colony hour, and badges: `CRISIS OVERRIDE ACTIVE (risk ≤ 28 · ≤ 2 Sacrifice)` in amber, or `Override denied — baseline plan exists`.
- **Five ResourceGauges:** a horizontal bar per resource. The track is `available`. The filled part is `used`, split into department-colored segments (hover → *"HAVEN L3: 23 · MERIDIAN M2: 21 …"*). Any overflow is a red hatched segment past the track end with `+N`. On the right: `used/available` and `reserve N`. A ghost marker shows the **requested** combination's total when it differs from the plan (so judges see the gap between asks and the plan).
- **RiskMeter:** a segmented bar of department risks against the limit (24, or 28 with override); the limit line is labeled.
- **SacrificeSlots:** `maxSacrifices` slots filled with the emblems of the sacrificing departments; empty slots are dotted.
- **ProtocolStepper:** the PDF's 7 steps with the active one highlighted. Mapping: BRIEFING(R1) → ① Publish · POSITIONS(R1) → ② Request · requested-plan check / SYNTHESIS conflicts → ③ Find conflicts · POSITIONS(R>1)/CONSENT → ④ Negotiate · SYNTHESIS(draft) → ⑤ Draft · VALIDATION/VOTING → ⑥ Validate & vote · DECISION → ⑦ Approve or continue.
- **RoundTracker:** dots `1…maxRounds`, filled through the current round, with a small "voting opens" marker at `minRoundsBeforeApproval`.
- **Plan status** appears both here and in the StatusBar (§6.1).

### 5.2 COUNCIL TRANSCRIPT (center column)
*PDF: persistent full history of all scenarios: agent, message type, round, plan version.*

- **Grouping:** a ScenarioDivider (`═══ S1 · Solar aftershock · 12:04:10 · outcome APPROVED v7 in R2 (0:41) ═══`) → RoundDividers (`── Round 2 · plan v5 ──`) → **turn groups**. Consecutive messages sharing a `turnId` render as one bordered group in the agent's color, with the header shown once and each typed sub-message as a section with its own type badge.
- **Every message shows the four PDF fields explicitly:** agent (emblem + callsign + department), **type badge**, **round** (`R2`), **plan version** (`v5`), plus recipients (`→ ALL` or `→ FORGE`), time, a **source badge** (`LLM gpt-5.6-terra 2.1s` · `FALLBACK` in amber with the reason on hover · `DETERMINISTIC` in gray · `HUMAN` in blue), and tool-call chips (`🔧 list_feasible_plans → 3 plans`).
- **Bodies by type:**
  - **BRIEFING:** statement, then an "Asks" list (`→ HAVEN: Would you accept L3?`).
  - **PROPOSAL:** statement; a package row (tier pill, `P27 W9 O36 R6 B3`, `risk 5`); consequence; reason.
  - **OBJECTION:** kind label (Resource conflict · Unfair sacrifice · **Sacrifice refused** · Risk limit · Missing return · Invalid plan), target, and detail. Sacrifice refusals get an extra red-outline treatment, because judges look for them.
  - **COUNTEROFFER:** statement; combo chips `L2 M2 F3 E3`; totals vs pool with per-resource OK/over coloring; risk; compensation terms; a **dry-run validator pill** (PASS/FAIL + first reason); a `claimedTotals` mismatch warning (*"FORGE claimed P78 — actual P79"*).
  - **COMMITMENT:** `C-4 · VERDANT → FORGE`, promise, kind/resource/amount, expiry, a status chip, and the action (OFFER / ACCEPT / DECLINE / REVIEW).
  - **PLAN_DRAFT:** a large version chip, label, selections, totals vs pool, risk, sacrifices, included commitments, **diff summary vs the previous version** (*"ENGINEERING E2→E3 (P−4 …) · +C-3 · votes cleared"*), rationale, and "responds to" links that scroll to the objections.
  - **VALIDATION:** a big PASS ✓ / FAIL ✗ pill + stage + a compact check list (icon + label + reason). Collapsed by default when PASS, expanded when FAIL.
  - **VOTE:** ACCEPT/REJECT pill, `v5 #3fa9c2`, reason, and conditions for accepting.
  - **APPROVAL:** a celebratory card: "PLAN v5 APPROVED", final validation PASS (n/n checks), 4/4 ACCEPT with names, hash, time to resolution.
  - **DECISION:** INFEASIBLE / DEADLOCK / TIMEOUT with blocking reasons and resolution text; INFEASIBLE embeds the CertificateCard (§7.2).
  - **EVENT:** an alert card with name, description, the `message_to_commander` quote, effects list, pool before → after.
  - **SYSTEM:** a compact line with icon (votes cleared, plan STALE/INVALID with reasons, commitment review as an expandable list, override invoked/denied, voting deferred, fallback notice, invalid ballot, deadline warning, approval blocked, resumed).
- **Footer actions on every message:** `Record` (pretty JSON of `data`), `output_schema` (for PROPOSAL/VOTE: the official-format record), and `Link` (copies `#M-0042`; the anchor scrolls and flashes the message).
- **Filters bar:** scenario (All / S0 / S1…), agents (multi-select emblem chips), types (multi-select chips), source (LLM/FALLBACK/DETERMINISTIC/HUMAN), text search, and a "Showing 84 of 132" counter. Default: **All scenarios** (persistent history).
- **Live behavior:** auto-scroll when the user is at the bottom; otherwise a floating "**3 new messages ↓**" pill. Thinking bubbles at the bottom for `run.activeAgents` (*"MERIDIAN is voting…"*), with the agent color and the current phase.
- **Performance:** memoize `MessageCard` by `id`; use `content-visibility: auto` on groups. Hundreds of messages must stay smooth.

### 5.3 MODE BOARD (right panel, default tab)
*PDF: each department's selected package, consequence, risk, return commitments, and conflicts.*

- **Header:** `Plan v5 · VOTING 2/4 · #3fa9c2 · label` + status chip. If the board shows the draft while a different plan is in force, show a toggle "Show plan in force (v3 · INVALID)".
- **Four DepartmentCards:**
  - emblem, callsign, department; tier pill of the **selected** mode + mode id (`E3 SACRIFICE`) + `risk 9`;
  - package values `P16 W4 O4 R14 B5` as mini bars relative to the pool;
  - "Requested: E2" chip when the department's own request differs from the plan (open disagreement is visible);
  - consequence text from the catalog (Sacrifice consequences in danger color);
  - **Return commitments** (only when sacrificing): `2/2 ✓` counter + rows (`C-3 · ACTUAL: assigns 2 Water reserve to rover cooling · 48 h · ACCEPTED`);
  - **Conflicts:** bullet list (§4.4), or "No conflicts";
  - **Stance** badge (REFUSE / CONDITIONAL / ACCEPT, conditions on hover) + **vote light** for this version;
  - click → Agent Mind sheet.
- **VotePanel:** four lights (ACCEPT green, REJECT red, pending gray pulse) for `boardPlan`. Below it: *"Votes cleared at v4 → v5 (3 votes)"* if applicable.

### 5.4 VALIDATION (right panel tab)
*PDF: PASS or FAIL with specific reasons.*

- A large verdict block: `PASS ✓` or `FAIL ✗`, stage (`DRY_RUN` / `PRE_VOTE` / `APPROVAL`), plan version + hash, timestamp, and the note *"Deterministic validator — pure TypeScript, no LLM involved."*
- All checks in order (§6.4 of Phase 1) as rows: icon, label, reason with numbers; expandable details (e.g., per-resource table: demand, cap, over).
- Warnings (claimed-totals mismatches, commitment conflicts) in amber.
- A "Report history for this plan" dropdown, since a plan can be validated several times (PRE_VOTE → APPROVAL).

### 5.5 JUDGE CONTROLS (labeled panel at the right of Mission Control; also mirrored in a compact header menu)
*PDF: Start, enter resources, inject event, reset, and export.*

| Control | Enabled when | Action |
|---|---|---|
| **▶ Start crisis** | `run.status === 'IDLE'` and S0 is PENDING | Opens StartDialog (resource editor, same as the idle hero) → `POST /api/control/start` |
| **⚡ Inject event** | S0 has started | Opens InjectEventDialog (§5.6) |
| **↻ Resume** | the current scenario resolved as DEADLOCK/TIMEOUT/INTERRUPTED | `POST /api/control/resume` (+2 rounds) |
| **⟲ Reset** | always | Confirm dialog: *"Archives this session (history stays in Session Archive) and starts a fresh council."* → `POST /api/control/reset` |
| **⤓ Export ▾** | always | Session JSON · Transcript CSV · Plans CSV · Votes CSV · Commitments CSV · Final allocation (output_schema). Phase 3 adds "Evidence pack (.zip)" |
| **⚙ Settings** | always | Sheet: read-only config (mode, models, limits, timeouts), presentation mode switch, judge access code field, link to `/api/health`, and a **Database card** (below) |

Disabled buttons always explain why in a tooltip (*"Negotiation in progress — inject will interrupt"* for Inject during a run, which is allowed but behind a confirmation).

**Database card (in Settings).** It makes the persistence layer visible to judges:
- Driver (`Supabase Postgres` or `Local file store`), project host, `ARES_INSTANCE_ID`, sync state, pending rows, last sync time, lease warning.
- A **"Verify persistence"** button that calls `/api/health?deep=1` and shows a table of row counts per `ares_*` table for this session next to the in-memory counts (messages, plans, votes, commitments, agent memory items), with ✓ when they match.
- In Supabase mode, a link *"Open in Supabase Table Editor"* (`https://supabase.com/dashboard/project/<ref>/editor`, with the ref taken from the project host). It's useful to the team; judges won't have access.
- A **danger zone**: "Delete all sessions for this instance" (hard reset). It requires typing `DELETE` and sends `{ hard: true, confirm: 'DELETE' }`. The normal Reset button never deletes history.

### 5.6 InjectEventDialog (Phase 2 = deterministic intake; Phase 3 adds an LLM interpreter and a full effects editor)

Tabs:
1. **Practice presets:** five cards (name, change, e.g., "Power −4") + an "Official sample (CRISIS_002, −30 % power)" card.
2. **JSON:** a textarea prefilled with the official `event_injection_format.json`, an "Upload .json" button, and a "Format" button. Inline JSON syntax errors.
3. **Quick manual:** per-resource rows (± units **or** ± %), and optionally risk limit, forbidden modes (multi-select of the 12 modes), and reserve requirement per resource.

Flow: **Preview impact** → `POST /api/events/interpret` → the EventPreview panel:
- interpretation title + summary, source badge (`DETERMINISTIC` / `PRESET` / `MANUAL`), confidence, warnings (e.g., unknown keys);
- the effects list in plain language (*"Power −30 % → 79 × 0.70 = 55.3 → 55 (rounded down for safety)"*);
- a pool before → after table with deltas;
- **Forecast:** *"Plan in force v3 would become INVALID (Power 79 > 55)"* or STALE; feasible plans under baseline limits **n** / under Crisis Override **m**; and, if 0/0, *"Proven INFEASIBLE"* with the certificate preview;
- a mini feasibility heatmap (§7.2) of the new state.

Then **Apply & reconvene council** → `POST /api/events/apply` → close the dialog, focus the new scenario, scroll the transcript to the EVENT message, and toast *"Event recorded — council reconvening (deadline 2:50)"*.

---

## 6. Always-visible status

### 6.1 StatusBar (sticky top)
Contents: brand · **ScenarioSwitcher** (pills `S0 Baseline ✓ APPROVED v2`, `S1 Solar aftershock ● R2`; clicking focuses the board and validation on that scenario, and a "follow live" pill returns to the current one) · **run status** (IDLE / NEGOTIATING / AWAITING COUNTERSIGN / APPROVED / INFEASIBLE / DEADLOCK / TIMEOUT / INTERRUPTED) · `R{round}/{max}` · **PlanChip** `Plan v5 #3fa9c2 · VOTING 2/4` (the plan stays visible throughout the run, as the PDF requires; click → History) · **Countdown** (§6.2) · **ModeIndicator** · **StorageBadge** (§4.4; click → Settings Database card) · **ConnectionDot** (live / reconnecting / offline) · settings · help.

### 6.2 Countdown
Shows `mm:ss` left until `deadlineAt` (from the server). It turns amber at 25 % remaining and red at 10 %. Once resolved it shows a stamp: **"Resolved in 0:41"** (green if ≤ 3:00 for event scenarios). This makes the PDF's 3-minute timing requirement visible.

### 6.3 Outcome banners (top of the transcript column; persistent per scenario until the next one starts)
- **APPROVED:** *"ACCORD REACHED — Plan v5 · round 3 · 4/4 ACCEPT · Validator PASS 8/8 · 0:52"*, with **View plan** and **Export** buttons.
- **INFEASIBLE:** *"INFEASIBLE — proven by exhaustive search of 81 combinations"* + the top blocking constraint + the request (*"+19 Power under Crisis Override"*) + **Simulate resupply** (builds a manual event from `certificate.closest[0].shortfall` → interpret → apply) + **View certificate**.
- **DEADLOCK / TIMEOUT:** reasons (who rejected and why, unresolved objections) + **Resume (+2 rounds)**.
- **INTERRUPTED:** the reason + **Resume**.
- **Plan in force STALE/INVALID** after an event: a slim amber/red bar *"Plan v3 INVALID — Power 79 > 75. Renegotiating…"*.

---

## 7. Differentiator views (right-panel tabs)

### 7.1 HISTORY: plan versions and diffs (*"judges should be able to see what changed between one plan version and the next"*)
- A vertical timeline, newest first, grouped by scenario. Each version shows the chip, status (DRAFT / FAILED / READY / VOTING / REJECTED / APPROVED / SUPERSEDED / STALE / INVALID), label, round, selections as tier-colored chips, totals vs pool, risk, validation verdict, and vote tally.
- Selecting a version shows the full detail: validation reports, ballots (cleared ones greyed out with "superseded"), included commitments, rationale, "responds to" messages, and the **diff vs the previous version** (mode changes with resource deltas, commitments added/removed, policy change).
- **Compare** mode: pick any two versions → side-by-side selections and totals with the deltas highlighted.

### 7.2 FEASIBILITY: Feasibility Explorer (*"Can we use an optimizer? Yes. Show how it works with the agents and the deterministic validator."*)
- A **9×9 heatmap** of all 81 combinations. Rows = Life Support × Medical (`L1M1 … L3M3`), columns = Food × Engineering (`F1E1 … F3E3`). Computed client-side from `src/engine/optimizer.evaluateAll` for the focus scenario.
- Cell colors: **feasible under the current policy** (success) · **feasible only with Crisis Override** (teal outline) · resources OK but risk/sacrifice limit violated (amber) · resource overflow (danger, intensity ∝ total overage) · forbidden mode (hatched).
- Overlays: the current plan cell (Mars ring), the plan in force (white ring), requested combinations from counteroffers (small dots).
- Hover → combination, totals vs pool, risk, sacrifices, violations. Click → "Evaluate" side panel (the same data the agents' `evaluate_combination` tool returns).
- A policy toggle: `Current policy` / `Crisis Override`. Summary: *"2 of 81 feasible under baseline limits · 7 with override (override not available before an event)"*.
- A **CertificateCard** when none is feasible: blocking constraints as bars (minimum achievable demand vs available), a closest-combinations table with shortfalls, requests, and policy alternatives.
- A caption that ties it to the agents: *"The Commander calls `list_feasible_plans` on this same engine — see 🔧 chips in the transcript."*

### 7.3 COMPLIANCE (our signature panel)
- The `computeCompliance` items (Phase 1 §6.9), grouped **Baseline negotiation · Post-event recovery · System**, each with a status icon (PASS ✓ / FAIL ✗ / PENDING … / NA –), the PDF requirement text, a detail with numbers (*"First approval in round 3"*, *"Resolved in 41 s (limit 180 s)"*), and **evidence chips** that scroll to and flash the exact transcript messages. The System group includes **`PERSISTED`** (*"132/132 messages persisted to Supabase · synced 0.3 s ago"*), with a chip that opens the Settings Database card.
- Header: *"14/14 requirements met for this session"*. It is computed from the live run and never edited by hand.

### 7.4 LEDGER: commitment ledger
A table of every commitment across scenarios: id, owner → beneficiary, promise, kind/resource/amount, expiry, status (with history on hover: OFFERED → ACCEPTED → ACTIVE → DUE …), scenario, and affordability against the current plan. Filters: scenario, status, agent.

### 7.5 ANALYTICS (optional; only if time permits)
- **Concession chart:** each department's requested tier per round, as step lines in agent colors (Standard = 3, Restricted = 2, Sacrifice = 1), across scenarios. It shows agents changing their requests.
- Message counts by type and by agent; LLM latency per agent (avg/p95); fallback count; round durations.

---

## 8. Agent Mind sheet (right-side drawer; opens from the roster, Mode Board, or transcript headers)

The goal is to prove *"each agent has its own goals, constraints, state, and message history"*:
- **Profile:** emblem, callsign, name, title, mission, main concern, goals, constraints, red lines, voice.
- **Live state:** requested mode, sacrifice stance + conditions, last vote, trust toward others (bars, if populated).
- **Timeline:** per scenario and round, requested mode → stance → vote (a compact table).
- **Private memory:** the `memory` notes, labeled 🔒 *"Private to this agent — never shown to the other agents."*
- **Ledger:** sacrifices taken (scenario, mode, plan version, returns received), commitments given and received with statuses.
- **Runtime:** SDK session id, `sessionItemCount`, LLM calls, fallbacks, average latency, input/output tokens, model, latest trace id (link to the OpenAI Traces dashboard; tracing must be on).
- **Persistence:** *"Private history persisted in Supabase — `ares_agent_memory`: 34 items · state in `ares_agent_states`"*. In file mode: *"local snapshot"*. This shows judges that each agent's message history is stored separately per agent.
- **Messages:** this agent's own messages and the messages addressed to it (its inbox), filtered from the transcript.

The **Council roster** (left column) shows five AgentCards: emblem, callsign, department, live status (thinking dots with phase / last action), requested mode, stance badge, vote light for the current plan, and FALLBACK/LLM counts. The Commander card shows the current action (*"drafting v5"*, *"validating"*).

---

## 9. Session Archive and read-only views
- `/sessions`: a list of archived sessions (created, scenarios, outcomes, message count) with **Open**. In Supabase mode the list comes from `ares_sessions` (this instance, newest first) via `/api/sessions`, captioned *"Stored in Supabase Postgres"*. That's the PDF's persistent history, and it survives restarts and redeploys. In file mode it comes from the local archive.
- `/sessions/[id]`: renders the **same dashboard components** from a static snapshot (`GET /api/sessions/[id]`), with no SSE and Judge Controls hidden, under a banner *"ARCHIVED SESSION — read-only"*. Export buttons work on the archive (`/api/export?sessionId=…`; add the query param server-side if missing).

## 10. Help dialog ("How to read this dashboard")
A single dialog (the `?` button) with short annotated sections: the panels by PDF name, the meaning of the status colors and source badges (LLM / FALLBACK / DETERMINISTIC / HUMAN), the 7-step protocol, and *"How to test: Start → watch → Inject event → Export"*. Keep it to one screen. Phase 3 can add a guided tour.

---

## 11. Accessibility and quality bar
- Keyboard: every control is focusable; dialogs trap focus; `Esc` closes. Shortcuts (shown in Help): `S` start, `E` inject event, `X` export menu, `/` focus transcript search, `F` toggle follow-live.
- `aria-live="polite"` region announces only outcomes and phase changes (not every message).
- Contrast ≥ 4.5:1 for text on panels. Statuses never use color alone.
- Empty, loading, and error states for every panel (skeletons while hydrating; *"No plan drafted yet — the Commander drafts after Round 1 positions"*).
- Zero React key warnings and zero console errors in a full run.
- Agent-written text (LLM output, injected noise, event descriptions) is always rendered as plain React text, which React escapes. Never use `dangerouslySetInnerHTML` or render agent text as Markdown/HTML.

## 12. Verification (manual QA script; run it in both modes)

Run once with `AGENT_MODE=offline` (deterministic) and once live:
1. Fresh load → idle hero shows 5 agents, resource inputs, and a feasibility preview (*"2 feasible plans"*). Change Power to 60 → the preview says 0 feasible / infeasible; reset to 79.
2. Start → the Commander's BRIEFING appears first; the stepper is on ① and moves to ②; the roster shows thinking dots; messages stream in grouped by turn.
3. Round 1 → PLAN_DRAFT v1 "Requested packages" + VALIDATION FAIL with five overages. Mission Control gauges show red overflow; the Feasibility tab shows 2 green cells.
4. Round 2 → `Sacrifice refused` objections are visible; COMMITMENT offers; a new PLAN_DRAFT with a diff; consent; VALIDATION PASS; *"Voting opens in round 3"*.
5. Round 3 → votes flip in; APPROVAL card; ACCORD banner; Compliance tab baseline items all ✓ with working evidence links.
6. Inject → Practice preset "Rover actuator failure" → preview shows Robot 26 → 22, plan in force → INVALID, feasible 0 / 1 → Apply. The transcript shows the EVENT card, PLAN_INVALID, COMMITMENT_REVIEW, the Crisis Override banner, a countdown from ~2:50, renegotiation over ≥ 2 rounds, and APPROVAL of `L3+M2+F2+E3` with **four** returns (two per sacrificing department). Resolved-in stamp ≤ 3:00.
7. Inject → JSON tab with the official sample → preview *"Proven INFEASIBLE · +19 Power"* → Apply → INFEASIBLE banner with certificate → **Simulate resupply** → renegotiation → APPROVED.
8. Export each format; open the CSV in a spreadsheet; FALLBACK messages (offline run) are labeled in the files.
9. Reset → fresh idle state; `/sessions` lists the archived session; opening it shows the full read-only history.
10. Kill and restart `npm run dev` mid-negotiation → the UI reconnects, shows INTERRUPTED + Resume; Resume continues.
11. **Database (Supabase mode):** the StorageBadge reads `DB · Supabase ✓` during the run (briefly `syncing (n)`). Settings → Database → **Verify persistence** shows matching counts for every table. In the Supabase Table Editor, `ares_messages` holds the same transcript. Run once with `STORAGE_DRIVER=file`: the badge reads `local file store`, everything else works, and the `PERSISTED` compliance item shows `NA`.
11. Resize to 1280×720 and 1024 px wide → layout adapts; nothing overlaps; the transcript stays readable.

## 13. Definition of Done (Phase 2)
- [ ] All five PDF views exist **with their exact names** and the PDF's listed contents.
- [ ] Live SSE updates with reconnect and gap recovery; plan version and status visible at all times.
- [ ] Transcript is persistent across scenarios, shows agent / type / round / plan version / source on every message, has filters and search, and groups turns.
- [ ] Mode Board shows package, consequence, risk, returns, conflicts, stance, and vote per department.
- [ ] Validation shows PASS/FAIL with specific reasons and stages.
- [ ] Judge Controls: start with resource entry, inject event (presets / JSON / quick manual) with preview, resume, reset (archived), export.
- [ ] History with diffs, Feasibility Explorer with certificate, Compliance with evidence links, Ledger, Agent Mind, Session Archive, Help.
- [ ] Outcome banners for APPROVED / INFEASIBLE (with simulate resupply) / DEADLOCK / TIMEOUT / INTERRUPTED; STALE/INVALID visible after events.
- [ ] Presentation mode; responsive down to 1024 px; zero console errors; QA script (§12) passes in offline and live modes.
- [ ] StorageBadge, Settings Database card (with Verify persistence and hard-reset danger zone), Supabase-backed Session Archive, persistence line in Agent Mind; the UI works identically in file mode.

## 14. Hand-off to Phase 3
Phase 3 adds: the LLM event interpreter and effects editor inside InjectEventDialog (new tab "Describe in words"); the human countersign modal (`AWAITING_COUNTERSIGN`); the Resilience Lab (fault injection, including a database outage) in Settings; **"Search all negotiations"** (Supabase full-text search across sessions); the "Evidence pack (.zip)" export item; the `/architecture` and `/health` pages; and an optional guided tour. Leave clean extension points: a tab registry in InjectEventDialog, an `ExportMenu` items array, and a Settings sheet section slot.
