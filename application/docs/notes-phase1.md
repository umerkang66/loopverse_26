# Phase 1 notes: live verification and latencies

Recorded 2026-10-09. Input for Phase 3 tuning.

## Live run (§12.3)

`npm run simulate -- --event=PRACTICE_SOLAR --bodies --db`. Agents ran on `gpt-5.6-terra` (commander and departments, reasoning effort `low`). The run persisted to Supabase under instance `sim-2026-10-09T18-10-59-789Z` and was kept as evidence.

| Scenario | Outcome | Rounds | Wall time | Plan |
|---|---|---|---|---|
| S0 baseline | APPROVED | 3 | 65.3 s | v3 L2+M2+F2+E3, risk 24, Engineering sacrifice (3 accepted returns) |
| S1 Solar aftershock (Power 79 → 75) | APPROVED | 2 | 55.3 s | v5 L3+M2+F3+E2, risk 28, Crisis Override, two sacrifices with 2/2 returns each |

- 92 messages: 77 LLM, **0 FALLBACK**, 15 deterministic. Every model call succeeded on the first attempt.
- Compliance 20/20, including PERSISTED. Supabase reported SYNCED with 92/92 messages.

**Transcript review against §12.3:** every point checked out.

- Five distinct voices:
  - HAVEN guards habitat air.
  - MERIDIAN talks about patients.
  - VERDANT talks about crop yield and reserve.
  - FORGE talks about repair capacity and refuses a *second consecutive* E3.
  - ACTUAL weighs the trade-offs.
- The departments facing a sacrifice refused first (HAVEN refused L3, VERDANT refused F3). They accepted only after the council offered two concrete returns from different agents.
- Every offer cites real numbers.
- Plans were revised: v1 (requested packages) failed the validator, then v2, then v3 after FORGE declined MERIDIAN's return.
- After the event:
  - v3 was marked INVALID (Power 79 > 75).
  - The commitment review moved C-1, C-3, and C-4 to DUE.
  - The Commander invoked Crisis Override with a justification ("exhaustive baseline search found zero feasible plans").
  - The Commander rotated the loss away from Engineering because it had sacrificed in S0.
- Tools were used naturally: 7 calls (`evaluate_combination` ×6, `get_commitment_ledger` ×1).

## Latency

Model latency per call:

| Call | n | avg | p50 | max |
|---|---|---|---|---|
| commander briefing | 2 | 4.8 s | 4.8 s | 4.8 s |
| department turn (POSITIONS, run in parallel) | 20 | 7.9 s | 9.3 s | 16.2 s |
| commander synthesis (with tools) | 3 | 9.5 s | 9.7 s | 11.7 s |
| consent micro-turn | 3 | 4.3 s | 4.4 s | 5.1 s |
| ballot | 8 | 2.4 s | 2.3 s | 3.2 s |
| commander decision | 2 | 2.5 s | 2.7 s | 2.7 s |

Wall time per round:

| Round | Wall time | Messages |
|---|---|---|
| S0 R1 | 17.7 s | 11 |
| S0 R2 | 25.5 s | 22 |
| S0 R3 | 17.3 s | 14 |
| S1 R1 | 37.8 s | 29 (override, consent) |
| S1 R2 | 17.6 s | 13 |

Phase wall time summed over all rounds:

| Phase | Total |
|---|---|
| POSITIONS | 49.3 s |
| SYNTHESIS | 35.7 s |
| CONSENT | 8.7 s |
| VALIDATION | 6.5 s |
| VOTING | 5.9 s |
| DECISION | 5.0 s |
| BRIEFING | 4.7 s |

Tokens: 38 LLM turns averaged **8.1k input / 370 output**.

## Tuning ideas for Phase 3

1. **Input tokens (8.1k per call) are the main cost and latency lever.**
   - Trim the private session history (`keepLastMessages`).
   - Shorten the instructions.
   - Cap the inbox lines.
   - Target ≤ 5k.
2. **POSITIONS is the long pole** (about 10 s per round). Its p50 is near the slowest of four parallel calls.
   - Try `gpt-5.4-mini` or reasoning `none` for departments, using `npm run bench:models`.
   - Keep `terra` for synthesis.
3. Ballots are already fast (2.4 s). Reasoning `none` works well there.
4. The event-scenario round 1 (37.8 s) bundles override, synthesis, and consent. It is still well inside the 3-minute requirement.

## Database verification (§12.6)

- **Migration applied.** The direct database host is IPv6-only and unreachable from here, so `npm run db:push` used the session pooler (found automatically, no password sent during discovery).
- **`npm run db:check`:** 11/11 tables OK.
- **`npm run db:advisors`:** no issues.
- **Publishable key:** gets `42501` on select and insert on `ares_*` tables. The migration explicitly revokes `anon`/`authenticated`.
- **`npm run test:db`:**
  - A baseline + event run reloads byte-for-byte from Postgres into a fresh runtime with an empty `DATA_DIR`.
  - `dbMessageCount` equals `messages.length`.
  - Reset archives the session and the new runtime follows it.
- **Crash test on `next dev`:**
  - Hard-killed the server mid-round 2 of a live run (no graceful flush) and deleted the local snapshot.
  - On restart the session reloaded from Supabase with all 10 messages, marked INTERRUPTED ("Server restarted during round 2… Use Resume").
  - `POST /api/control/resume` continued in round 3 and approved v2: 37/37 messages in the database, 0 fallbacks.
- **Lease after a crash:** the restart used to show a false "Another runtime is writing" warning, because the dead process's 30 s lease had not expired.
  - Fixed: a lease held by a dead PID on the same host is now taken over silently.
  - Any other conflict is re-checked when that lease expires.

## Fixes made after reading the live transcript

- **Plan labels:** the engine strips a model-written `"vN —"` prefix. In the live run, plan v3 had been labeled "v2 — …".
- **Dry-run counteroffers** now name the failing checks, e.g. `dry-run FAIL (RETURN_AGREEMENT)`.
- **Sacrifice refusals:**
  - Posted every round only while the plan on the table designates that sacrifice. Otherwise they are posted once per scenario, so no repeated refusals of a mode nobody proposes.
  - Their body is the agent's conditions instead of a copy of its proposal.

## Known deviations

- **An event with `requires_replan: false` still renegotiates** (at least 2 rounds), with no shortcut that reaffirms the plan. This keeps PDF §06 ("at least 2 visible rounds unless infeasibility is proven") true for every event. The flag is recorded on the EVENT message.
- **R2+ briefings** come from the previous synthesis (`nextBrief`). They are LLM text but carry no `meta` of their own: model and latency sit on the synthesis message.
