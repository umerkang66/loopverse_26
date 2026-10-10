# ARES ACCORD — application

Five AI agents (Commander + four department heads, OpenAI Agents SDK) negotiate a Mars colony's scarce resources
under a deterministic validator. Next.js 16 (App Router, Node runtime). Supabase Postgres is the system of
record, with a local snapshot as a safety net.

> Phase 1 status: engine, agents, protocol, persistence, API, and a debug console at `/dev`.
> Phase 2 builds the Mission Control UI at `/`.

## Run it

```bash
cd application
npm install
npm run dev            # http://localhost:3000/dev
```

- **Agents:** live when `OPENAI_API_KEY` is set in `.env`, otherwise labeled rule-based fallback (`AGENT_MODE=offline` forces it).
- **Storage:** Supabase when `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are set (`STORAGE_DRIVER=auto`), otherwise a local file store in `DATA_DIR`.
  Both modes keep a crash-safe local snapshot.
- Copy `.env.example` to `.env` to configure. It lists names only, never commit values.

## Database (Supabase, optional)

```bash
npm run db:push        # applies supabase/migrations (11 ares_* tables, RLS on, service_role-only grants)
npm run db:check       # head-count per table: OK / MISSING GRANT / MISSING TABLE
npm run db:advisors    # Supabase security + performance advisors (fails on WARN)
```

`db:push`, `db:advisors`, and `db:types` connect with `DB_PASSWORD`. They target the database in this order:
`--db-url`, then `SUPABASE_DB_URL`, then a linked project, then the direct host when reachable, then the session pooler.
The pooler is found automatically; no password is sent during that discovery.
You can also paste the migration into the Dashboard SQL Editor.
The browser never talks to Supabase. The secret key is server-only, and boot fails if a secret sits behind a `NEXT_PUBLIC_` name.

## Scripts

| Command | What it does |
|---|---|
| `npm run simulate -- --offline --event=PRACTICE_ROVER` | Full council in-process: transcript, outcomes, timings, compliance table; exit 1 on a failed item |
| `npm run simulate -- --event=PRACTICE_SOLAR --bodies` | Same with live agents (prints every agent's words) |
| | Flags: `--event=<preset>\|official\|none`, `--json`, `--out=<file>`, `--db` (persist under `sim-<timestamp>`), `--max-rounds=N`, `--resources=P,W,O,R,B` |
| `npm run check` | typecheck + lint + unit/integration tests (no network) |
| `npm run test:db` | Supabase round-trip tests (throwaway instance, cleaned up) |
| `npm run reset:data -- --yes` | Deletes the local `DATA_DIR` |

## API

| Route | Purpose |
|---|---|
| `GET /api/health[?deep=1]` | Mode, models (checked), storage status; `deep` adds per-table row counts |
| `GET /api/state[?sinceSeq=N]` | Public state + transcript |
| `GET /api/stream` | Server-Sent Events (`Last-Event-ID` replay, 15 s heartbeat) |
| `POST /api/control/start` | `{ resources?, maxRounds? }` → 202 |
| `POST /api/control/resume` · `/reset` · `/countersign` | Resume a deadlock/timeout/interruption · archive (`{hard:true, confirm:"DELETE"}` deletes) · HITL decision |
| `POST /api/events/interpret` → `POST /api/events/apply` | Preview an event with a feasibility forecast, then inject it |
| `GET /api/export?format=json\|csv\|final` | Session JSON, CSV sheets (`kind=transcript\|plans\|votes\|commitments`), `final_allocation.json`; `&sessionId=` for archives |
| `GET /api/sessions` · `/api/sessions/[id]` | Archive list / one archived session |

When `JUDGE_ACCESS_CODE` is set, every POST needs the header `x-judge-code`.

## Layout

```
src/domain     scenario data (ares-accord.json), types       — pure, client-safe
src/engine     validator, optimizer, infeasibility, events…  — pure, unit-tested
src/server     runtime, orchestrator, agents (SDK), persistence (Supabase + snapshot), exports
src/app        API routes, /dev console
supabase/      migrations
tests/         offline integration, scripted-model gateway, API, Supabase (*.it.ts)
```
