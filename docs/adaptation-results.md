# ARES ACCORD — Adaptation Test Results (U1–U11)

> **Unseen-Crisis Adaptation & Resilience Benchmark**
> Verified against baseline resource pool `79 / 52 / 59 / 26 / 17` (Power, Water, Oxygen, Robot Time, Bandwidth).
> Requirement: Every unseen crisis must resolve to a verified plan or a proven INFEASIBLE certificate within **180 seconds (3:00)** without code changes.

---

## 1. Summary Matrix

| #       | Crisis Name                   | Input Format              | Interpreted Effects                                            | Deterministic Engine Outcome                                                                                                          | Resolution Time | Status   |
| ------- | ----------------------------- | ------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------- | -------- |
| **U1**  | Dust storm                    | JSON with nested drop pct | Power −25% (parser), Relay blackout 12h (INFO + assumption)    | Pool Power 59: **INFEASIBLE**. Short +15 Power under Crisis Override (`L2+M2+F3+E3` / `L3+M2+F3+E2`)                                  | 42.4 s          | **PASS** |
| **U2**  | Hydroponics pump burst        | JSON with bare key        | Water −6 (parser)                                              | Pool Water 46: **INFEASIBLE**. Short only +1 Water under Crisis Override. Policy alternative: 3rd Sacrifice (risk 32) yields 4 plans  | 38.1 s          | **PASS** |
| **U3**  | Airlock accident              | Plain prose               | FORBID_MODE M3, RESERVE_REQUIREMENT oxygen 3, PRIORITY MEDICAL | Baseline feasible: 0. Crisis Override: **exactly 1 plan** (`L3+M2+F2+E3`, risk 24). Council adapts and approves in R2                 | 48.6 s          | **PASS** |
| **U4**  | Supply drone delivery         | Plain prose               | Power +8, Water +5 (resource increases)                        | Pool 87/57/59/26/17: Paths A and B feasible. Plan in force **STALE (not INVALID)**. Crisis Override **denied**. Re-approved           | 41.2 s          | **PASS** |
| **U5**  | Robot time set                | JSON impact object        | Robot SET 18 (parser)                                          | Pool Robot 18: **INFEASIBLE**. Short +4 Robot under Crisis Override (`L3+M2+F2+E3`)                                                   | 35.8 s          | **PASS** |
| **U6**  | Mission Control risk cap      | Plain prose               | RISK_LIMIT 22 (hard risk cap)                                  | **INFEASIBLE**: all 12 resource combinations require risk ≥ 24. Certificate recommends lifting risk cap 22 → 24 for 2 feasible plans  | 37.3 s          | **PASS** |
| **U7**  | Relay satellite lost          | Plain prose               | Bandwidth −50%                                                 | Pool Bandwidth 8: **INFEASIBLE**. Short +7 Bandwidth. Certificate generated with exact shortfall                                      | 36.5 s          | **PASS** |
| **U8**  | Rover drive train             | Plain prose               | FORBID_MODE E1                                                 | Paths A and B unaffected (use E2/E3). Plan in force **STALE**. Reaffirmation round with 4 fresh ballots. Approved                     | 44.1 s          | **PASS** |
| **U9**  | Cascade failure               | Plain prose               | Power −6, Oxygen −2, Robot −3                                  | Pool 73/52/57/23/17: **INFEASIBLE**. Best plan `L3+M2+F2+E3` short only **+2 Power** (near miss)                                      | 43.7 s          | **PASS** |
| **U10** | Greenhouse fire               | Official JSON variant     | Oxygen −2, Food capacity (PRIORITY FOOD + INFO)                | Oxygen 57: Baseline has **exactly 1 plan**, Path A (`L3+M2+F2+E2`). Sacrifice flips from Engineering to Life Support. Override denied | 51.3 s          | **PASS** |
| **U11** | Solar Flare (Official sample) | Official starter kit JSON | Power −30%, duration 6h, trigger hour 14                       | Pool Power 55: **INFEASIBLE**. Short +19 Power (Crisis Override) / +24 Power (Baseline). Hearing + Certificate                        | 39.0 s          | **PASS** |

---

## 2. Key Observations & Protocol Compliance

1. **Strict 3-Minute Limit:**
   All 11 scenarios resolved in **under 55 seconds**, well within the 180 s (3:00) hard deadline. Average resolution time: **41.6 seconds**.

2. **Hybrid Provenance Integrity:**
   - Deterministic parser extracted exact values from explicit numeric JSON fields with origin `parser`.
   - The LLM Event Intake officer parsed prose expressions (e.g. "halved", "cannot drop to Sacrifice mode", "held in reserve") with origin `llm`.
   - When judge manual edits occur, provenance records origin `judge` and source `MANUAL`.

3. **Gating Rules Enforced:**
   - In U4 and U10, Crisis Override was strictly **denied** because valid baseline plans existed.
   - In U3, Crisis Override was **granted** because 0 baseline plans existed but 1 override plan was feasible.
   - In U1, U2, U5, U6, U7, U9, and U11, the exhaustive engine proved zero feasible combinations exist and generated an **Infeasibility Certificate** detailing exact shortfalls and policy alternatives.

4. **Promise Memory & Trust:**
   - In U10, when the sacrifice flipped from Engineering to Life Support, previous commitment C-2 was fulfilled and Engineering was released from sacrifice.
   - Unavoidable sacrifice breaches carried zero trust penalties, while fulfilled promises increased inter-agent trust by +0.2.
