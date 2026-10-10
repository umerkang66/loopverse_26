# ARES ACCORD — Team Declaration

## Team Information

- **Team Name:** ARES ACCORD Team
- **Team Members:**
  - **Muhammad Umer** — Lead Agent Architect & Full-Stack Systems Engineer (Agent coordination, deterministic engine, Next.js UI, resilience lab, Supabase persistence)
  - **Haseeb Ullah** - ML/DL/Agentic AI engineer.

---

## Models & APIs

- **OpenAI Responses API / Agents SDK:**
  - SDK Version: `@openai/agents` v0.20.0
  - Primary Commander Model: `gpt-5.6-terra` (reasoning effort: `low`)
  - Department Agents Model: `gpt-5.6-terra` (reasoning effort: `low`)
  - Failover / Fast Model: `gpt-5.4-mini`
  - Platform Tracing: Enabled via OpenAI Responses API traces
- **Database & Persistence:**
  - System of Record: **Supabase Postgres 17** via `@supabase/supabase-js` v2.117.3
  - CLI & Migrations: Supabase CLI v2.120.0 (`supabase/migrations/`)
  - Security Model: Row Level Security (RLS) on all 11 tables, `service_role`-only server grants, `security invoker` RPC functions with revoked `anon`/`authenticated` execute.
  - Non-blocking write-behind queue with crash-safe local file store buffer.

---

## Software Libraries & Attributions

- **Frontend & Fullstack Framework:** Next.js 16.4.0 (App Router, Node runtime), React 19.3.0, TypeScript 5
- **Styling & UI Components:** Tailwind CSS v4, shadcn/ui (Radix UI primitives), Lucide React, Motion (v14.1.0)
- **State & Streaming:** Zustand v5, Server-Sent Events (SSE with gap recovery and 15s heartbeats), Sonner
- **Validation & Parsing:** Zod v4, fflate (zipSync for evidence packs), Mermaid (diagram generation)
- **Testing & Execution:** Vitest v5, tsx, ESLint 9

---

## Pre-existing Code & Starter Kit

- **Pre-existing Code:** **None.** All application code, agent schemas, negotiation orchestrators, deterministic validators, and UI panels were written during the 24-hour hackathon window.
- **Starter Kit Assets:** Scenario golden facts, department mode packages, and crisis injection format JSON specifications are derived from the official LifixLabs ARES ACCORD challenge brief.

---

## AI Tools Declaration

- **AI Coding Assistance:** Google DeepMind Antigravity CLI / Gemini 3.8 Flash (High) used for rapid prototyping, architecture scaffolding, test fixture generation, and pair programming.
