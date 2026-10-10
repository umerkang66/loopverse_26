-- Cross-session full-text search and insights over the durable negotiation history.
-- Both functions are `security invoker` (never definer), pin search_path, schema-qualify every table, and are
-- executable by the server role only (the browser never talks to Supabase).

-- Ranked full-text search over every negotiation of one instance (uses the GIN index on ares_messages.search).
create or replace function public.ares_search_messages(p_query text, p_instance text, p_limit integer default 50)
returns table (
  session_id uuid, seq integer, message_id text, scenario_id text, round integer, type text, subtype text,
  from_actor text, plan_version integer, created_at timestamptz, headline text, rank real
)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.session_id, m.seq, m.message_id, m.scenario_id, m.round, m.type, m.subtype,
         m.from_actor, m.plan_version, m.created_at,
         ts_headline('english', m.summary || ' — ' || m.body, q,
                     'StartSel=«, StopSel=», MaxFragments=2, MaxWords=18, MinWords=6') as headline,
         ts_rank(m.search, q) as rank
  from public.ares_messages m
  join public.ares_sessions s on s.id = m.session_id
  cross join websearch_to_tsquery('english', p_query) as q
  where s.instance_id = p_instance
    and m.search @@ q
  order by rank desc, m.created_at desc
  limit least(greatest(p_limit, 1), 200);
$$;

-- Aggregate insights across all sessions of one instance.
create or replace function public.ares_insights(p_instance text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'sessions', (select count(*) from public.ares_sessions s where s.instance_id = p_instance),
    'scenarios_by_outcome', (
      select coalesce(jsonb_object_agg(t.outcome, t.n), '{}'::jsonb)
      from (select sc.outcome, count(*) as n
            from public.ares_scenarios sc join public.ares_sessions s on s.id = sc.session_id
            where s.instance_id = p_instance and sc.outcome is not null
            group by sc.outcome) t),
    'sacrifices_by_department', (
      select coalesce(jsonb_object_agg(t.dept, t.n), '{}'::jsonb)
      from (select unnest(p.sacrifices) as dept, count(*) as n
            from public.ares_scenarios sc
            join public.ares_sessions s on s.id = sc.session_id
            join public.ares_plans p on p.session_id = sc.session_id and p.version = sc.approved_plan_version
            where s.instance_id = p_instance
            group by 1) t),
    'refusals_by_department', (
      select coalesce(jsonb_object_agg(t.from_actor, t.n), '{}'::jsonb)
      from (select m.from_actor, count(*) as n
            from public.ares_messages m join public.ares_sessions s on s.id = m.session_id
            where s.instance_id = p_instance and m.subtype = 'SACRIFICE_REFUSAL'
            group by m.from_actor) t),
    'avg_rounds_to_approval', (
      select round(avg((sc.data->>'round')::int)::numeric, 2)
      from public.ares_scenarios sc join public.ares_sessions s on s.id = sc.session_id
      where s.instance_id = p_instance and sc.outcome = 'APPROVED'),
    'avg_event_resolution_seconds', (
      select round(avg(extract(epoch from (sc.resolved_at - sc.started_at)))::numeric, 1)
      from public.ares_scenarios sc join public.ares_sessions s on s.id = sc.session_id
      where s.instance_id = p_instance and sc.kind = 'EVENT' and sc.resolved_at is not null)
  );
$$;

-- Functions in public are executable by PUBLIC by default: lock both down to the server role only.
revoke execute on function public.ares_search_messages(text, text, integer) from public, anon, authenticated;
revoke execute on function public.ares_insights(text) from public, anon, authenticated;
grant execute on function public.ares_search_messages(text, text, integer) to service_role;
grant execute on function public.ares_insights(text) to service_role;
