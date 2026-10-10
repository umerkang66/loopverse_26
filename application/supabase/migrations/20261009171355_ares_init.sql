-- ARES ACCORD · initial schema (Supabase Postgres 17)
-- Access model: ONLY the app server touches these tables, using the secret key (role service_role, BYPASSRLS).
-- anon/authenticated receive NO grants, so the tables are unreachable with the publishable key.
-- RLS is enabled everywhere as defense in depth (no policies = deny for every non-bypass role).

create table public.ares_sessions (
  id                    uuid primary key,                    -- app-generated UUIDv7 (time-ordered, no index fragmentation)
  instance_id           text not null,                       -- ARES_INSTANCE_ID (local, hosted, sim-…, it-…)
  scenario_config_id    text not null,
  catalog_hash          text not null,
  mode                  text not null check (mode in ('live','offline')),
  status                text not null default 'active' check (status in ('active','archived')),
  config                jsonb not null,
  run                   jsonb not null,                      -- RunState
  counters              jsonb not null,
  plan_in_force_version integer,
  summary               jsonb not null default '{}'::jsonb,  -- per-scenario outcomes + counts, for the archive list
  created_at            timestamptz not null,
  updated_at            timestamptz not null
);
create index ares_sessions_instance_created_idx on public.ares_sessions (instance_id, created_at desc);

create table public.ares_instances (
  instance_id        text primary key,
  current_session_id uuid references public.ares_sessions (id) on delete set null,
  lease_owner        text,                                   -- "<hostname>:<pid>:<bootId>" of the runtime writing this instance
  lease_expires_at   timestamptz,
  updated_at         timestamptz not null
);
create index ares_instances_current_session_idx on public.ares_instances (current_session_id);

create table public.ares_scenarios (
  session_id            uuid not null references public.ares_sessions (id) on delete cascade,
  scenario_id           text not null,                       -- 'S0', 'S1', …
  idx                   integer not null,
  kind                  text not null check (kind in ('BASELINE','EVENT')),
  title                 text not null,
  status                text not null check (status in ('PENDING','NEGOTIATING','AWAITING_COUNTERSIGN','RESOLVED')),
  outcome               text check (outcome in ('APPROVED','INFEASIBLE','DEADLOCK','TIMEOUT','INTERRUPTED')),
  approved_plan_version integer,
  started_at            timestamptz,
  resolved_at           timestamptz,
  data                  jsonb not null,                      -- the full Scenario object
  updated_at            timestamptz not null,
  primary key (session_id, scenario_id)
);

create table public.ares_events (
  session_id     uuid not null references public.ares_sessions (id) on delete cascade,
  event_id       text not null,                              -- 'EV-1'
  scenario_id    text not null,
  title          text not null,
  source         text not null check (source in ('DETERMINISTIC','LLM','HYBRID','MANUAL','PRESET')),
  received_at    timestamptz not null,
  pool_before    jsonb not null,
  pool_after     jsonb not null,
  interpretation jsonb not null,
  primary key (session_id, event_id)
);

create table public.ares_plans (
  session_id        uuid not null references public.ares_sessions (id) on delete cascade,
  version           integer not null,
  scenario_id       text not null,
  round             integer not null,
  hash              text not null,
  label             text not null,
  status            text not null check (status in ('DRAFT','FAILED','READY','VOTING','REJECTED','APPROVED','RATIFIED','SUPERSEDED','STALE','INVALID')),
  life_support_mode text not null check (life_support_mode in ('L1','L2','L3')),
  medical_mode      text not null check (medical_mode in ('M1','M2','M3')),
  food_mode         text not null check (food_mode in ('F1','F2','F3')),
  engineering_mode  text not null check (engineering_mode in ('E1','E2','E3')),
  risk              integer not null,
  sacrifices        text[] not null,
  commitment_ids    text[] not null,
  totals            jsonb not null,
  reserve           jsonb not null,
  policy            jsonb not null,
  pool_snapshot     jsonb not null,
  diff              jsonb,
  rationale         text not null,
  status_reason     text,
  data              jsonb not null,                          -- the full Plan (without validations/votes, which have their own tables)
  created_at        timestamptz not null,
  updated_at        timestamptz not null,
  primary key (session_id, version)
);
create index ares_plans_scenario_idx on public.ares_plans (session_id, scenario_id);

create table public.ares_plan_validations (
  session_id    uuid not null references public.ares_sessions (id) on delete cascade,
  plan_version  integer not null,
  report_no     integer not null,                            -- position in Plan.validations
  stage         text not null check (stage in ('DRY_RUN','PRE_VOTE','APPROVAL')),
  status        text not null check (status in ('PASS','FAIL')),
  plan_hash     text,
  failed_checks text[] not null,
  report        jsonb not null,                              -- the full ValidationReport
  evaluated_at  timestamptz not null,
  primary key (session_id, plan_version, report_no)
);

create table public.ares_votes (
  session_id   uuid not null references public.ares_sessions (id) on delete cascade,
  vote_id      text not null,                                -- 'V-12'
  plan_version integer not null,
  plan_hash    text not null,
  agent_id     text not null check (agent_id in ('LIFE_SUPPORT','MEDICAL','FOOD','ENGINEERING')),
  decision     text not null check (decision in ('ACCEPT','REJECT')),
  reason       text not null,
  conditions   jsonb not null default '[]'::jsonb,
  round        integer not null,
  source       text not null check (source in ('LLM','FALLBACK','DETERMINISTIC','HUMAN')),
  created_at   timestamptz not null,
  primary key (session_id, vote_id)
);
create index ares_votes_plan_idx on public.ares_votes (session_id, plan_version);

create table public.ares_commitments (
  session_id    uuid not null references public.ares_sessions (id) on delete cascade,
  commitment_id text not null,                               -- 'C-3'
  scenario_id   text not null,
  owner         text not null,
  beneficiary   text not null,
  kind          text not null check (kind in ('RESOURCE_SHARE','RESERVE_ASSIGNMENT','PRIORITY','FUTURE_RESOURCE','OTHER')),
  resource      text,
  amount        integer,
  promise       text not null,
  status        text not null check (status in ('OFFERED','ACCEPTED','DECLINED','WITHDRAWN','ACTIVE','DUE','FULFILLED','BREACHED','VOID','EXPIRED')),
  data          jsonb not null,                              -- the full Commitment (expiry, history, …)
  updated_at    timestamptz not null,
  primary key (session_id, commitment_id),
  constraint ares_commitments_owner_not_beneficiary check (owner <> beneficiary)
);

create table public.ares_messages (
  session_id   uuid not null references public.ares_sessions (id) on delete cascade,
  seq          integer not null,
  message_id   text not null,                                -- 'M-0042'
  scenario_id  text not null,
  round        integer not null,
  phase        text not null,
  from_actor   text not null,
  to_actors    text[] not null,                              -- {ALL} or agent ids
  type         text not null check (type in ('BRIEFING','PROPOSAL','OBJECTION','COUNTEROFFER','COMMITMENT','PLAN_DRAFT','VALIDATION','VOTE','APPROVAL','DECISION','EVENT','SYSTEM')),
  subtype      text,
  summary      text not null,
  body         text not null,
  plan_version integer,
  turn_id      text,
  source       text not null check (source in ('LLM','FALLBACK','DETERMINISTIC','HUMAN')),
  model        text,
  latency_ms   integer,
  trace_id     text,
  data         jsonb not null,
  meta         jsonb,
  created_at   timestamptz not null,
  search       tsvector generated always as (to_tsvector('english', summary || ' ' || body)) stored,
  primary key (session_id, seq)
);
create index ares_messages_scenario_idx on public.ares_messages (session_id, scenario_id, seq);
create index ares_messages_search_idx on public.ares_messages using gin (search);

create table public.ares_agent_states (
  session_id uuid not null references public.ares_sessions (id) on delete cascade,
  agent_id   text not null check (agent_id in ('COMMANDER','LIFE_SUPPORT','MEDICAL','FOOD','ENGINEERING')),
  state      jsonb not null,                                 -- AgentState minus sessionItems
  updated_at timestamptz not null,
  primary key (session_id, agent_id)
);

-- Each agent's PRIVATE Agents-SDK session history (its own message history), one row per item.
create table public.ares_agent_memory (
  session_id uuid not null references public.ares_sessions (id) on delete cascade,
  agent_id   text not null check (agent_id in ('COMMANDER','LIFE_SUPPORT','MEDICAL','FOOD','ENGINEERING')),
  item_no    integer not null,
  item       jsonb not null,                                 -- AgentInputItem
  created_at timestamptz not null,
  primary key (session_id, agent_id, item_no)
);

-- RLS on every table (defense in depth). service_role bypasses RLS; anon/authenticated hold no grants at all.
alter table public.ares_sessions         enable row level security;
alter table public.ares_instances        enable row level security;
alter table public.ares_scenarios        enable row level security;
alter table public.ares_events           enable row level security;
alter table public.ares_plans            enable row level security;
alter table public.ares_plan_validations enable row level security;
alter table public.ares_votes            enable row level security;
alter table public.ares_commitments      enable row level security;
alter table public.ares_messages         enable row level security;
alter table public.ares_agent_states     enable row level security;
alter table public.ares_agent_memory     enable row level security;

-- Older projects may still carry default privileges that grant new public tables to anon/authenticated:
-- remove them explicitly so the publishable key can never reach these tables, whatever the project's defaults.
revoke all on table
  public.ares_sessions, public.ares_instances, public.ares_scenarios, public.ares_events, public.ares_plans,
  public.ares_plan_validations, public.ares_votes, public.ares_commitments, public.ares_messages,
  public.ares_agent_states, public.ares_agent_memory
from anon, authenticated;

-- Data API exposure. REQUIRED since the 2026-04-28 breaking change: new tables are not exposed automatically.
-- Server role only (least privilege); deliberately no grants to anon/authenticated.
grant select, insert, update, delete on table
  public.ares_sessions, public.ares_instances, public.ares_scenarios, public.ares_events, public.ares_plans,
  public.ares_plan_validations, public.ares_votes, public.ares_commitments, public.ares_messages,
  public.ares_agent_states, public.ares_agent_memory
to service_role;
