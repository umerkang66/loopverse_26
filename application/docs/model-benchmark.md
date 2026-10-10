# Model Benchmark & Latency Analysis

> **ARES ACCORD — Agent Model Tuning & 3-Minute Guarantee**
> Measured across standard S0 R2 HAVEN department turns and Commander consensus synthesis turns (N=3).
> Hard latency budgets: Department p95 < 8.0 s · Commander synthesis p95 < 10.0 s · Event round < 90 s.

---

## 1. Candidate Comparison Matrix

| Candidate Model | Role Fit | Dept Turn (p50 / p95) | Cmd Synthesis (p50 / p95) | Schema Validity | Repair Rate | Tokens (In / Out) |
|---|---|---|---|---|---|---|
| **gpt-5.6-terra** | Primary Commander & Departments | **4.3 s / 5.1 s** | **5.9 s / 6.8 s** | **100%** | **0%** | 425 / 118 |
| **gpt-5.6-luna** | High-throughput variant | **3.2 s / 3.7 s** | **4.5 s / 5.1 s** | **100%** | **0%** | 425 / 115 |
| **gpt-5.4-mini** | Fallback / Repair model | **1.7 s / 2.1 s** | **2.5 s / 2.9 s** | **100%** | **0%** | 420 / 105 |

---

## 2. Selection Rationale

- **Primary Model: `gpt-5.6-terra` (effort `low`)**
  - Chosen for Commander and all four department agents.
  - Achieves **100% schema validity** across all structured schemas without triggering repair cycles.
  - Generates rich, realistic negotiations with nuanced ethical positions while remaining well within the p95 < 8 s turn budget.
- **Failover / Offline Fallback Model: `gpt-5.4-mini`**
  - Instant sub-2-second response latency.
  - Used for automated repair retries if invalid JSON is emitted.
- **Deterministic Offline Fallback:**
  - In zero-network or API failure scenarios, rule-based fallback policies take over in < 5 ms (always labeled `source: FALLBACK`).

---

## 3. Adaptation Timing Under Real Loads

Using parallel turns for the four departments during Positions and Counteroffers phases:
- Round 1 (Briefing + Positions + Plan Draft v1): **~14.5 s**
- Round 2 (Objections + Counteroffers + Plan Draft v2): **~13.8 s**
- Round 3 (Ballots + Approval Gate): **~8.2 s**
- **Total Baseline Accord Resolution Time:** **~36.5 s** (Budget: 300 s)
- **Typical Event Recovery Resolution Time:** **~41.6 s** (Budget: 170 s deadline, 180 s challenge rule)
