-- ============================================================================
-- 0027 — log every sign-in (email, time, IP, device) for platform admins
-- ============================================================================
-- Supabase already knows all four: auth.sessions carries the client IP and the
-- user-agent of every sign-in. It just does not keep them — GoTrue deletes the
-- row on sign-out or expiry, so the table is a list of who is signed in NOW,
-- not who ever was. auth.audit_log_entries keeps history (email + timestamp,
-- 13 months of it on this project) but its ip_address column is '' on every
-- row and it has no user-agent at all. Neither is a log; together they still
-- aren't. So: copy each auth.sessions row into a table of our own the moment
-- it appears, before GoTrue can remove it.
--
-- ---- the trigger is on a table we do not own --------------------------------
-- auth.sessions belongs to supabase_auth_admin. `postgres` holds TRIGGER on it
-- (has_table_privilege, checked 2026-09-17), the same standing that lets 0001
-- put on_auth_user_created on auth.users. Two consequences:
--
--  * GoTrue writes as supabase_auth_admin, which has no rights on public.*,
--    so record_login_event() is SECURITY DEFINER — it runs as postgres, like
--    handle_new_user(). EXECUTE is revoked from every client role: no client
--    can call a trigger function anyway (0016), and the acl suite asserts it.
--
--  * ⚠️ An exception in this function rolls back the auth.sessions INSERT,
--    i.e. it turns every sign-in into a 500. The body is wrapped in
--    `exception when others then return new` so nothing can escape. Logging
--    is not worth an outage; a missed row is. Keep it that way.
--
-- ---- who can read it --------------------------------------------------------
-- Platform admins, over the table, under RLS. Nobody can write it from a
-- client: no INSERT/UPDATE/DELETE grant, no policy. Same append-only posture
-- as rate_events (§13.1), minus the SELECT revoke.
--
-- email is a snapshot taken at sign-in. profiles is own-row-only under RLS,
-- so an admin reading login_events from the browser could not join to it;
-- and auth.users is out of PostgREST's reach entirely.
--
-- ip is text, via host(): auth.sessions.ip is inet, and inet's text form
-- carries the netmask ("106.192.51.28/32"), which is noise on a page and a
-- trap for an email/IP search.
--
-- ---- retention --------------------------------------------------------------
-- An IP plus a user-agent is personal data. 180 days, pruned hourly by pg_cron
-- next to prune-rate-events (§13.5). ON DELETE CASCADE from auth.users takes
-- care of deleted accounts.
--
-- ---- what it does not capture -----------------------------------------------
-- Failed sign-ins (no session is created — and Supabase's audit log has no
-- such action either) and geolocation. Both would need an app-side path.

-- ---- table -------------------------------------------------------------------
create table if not exists public.login_events (
  id           bigint generated always as identity primary key,
  user_id      uuid        not null references auth.users(id) on delete cascade,
  session_id   uuid        unique,
  email        text,
  ip           text,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists login_events_created_idx on public.login_events (created_at desc);
create index if not exists login_events_email_idx   on public.login_events (email);

-- ---- access ------------------------------------------------------------------
alter table public.login_events enable row level security;
revoke all on public.login_events from anon, authenticated;
grant select on public.login_events to authenticated;

drop policy if exists "Platform admins read login events" on public.login_events;
create policy "Platform admins read login events" on public.login_events
  for select to authenticated
  using ((select public.is_platform_admin()));

-- ---- trigger -----------------------------------------------------------------
create or replace function public.record_login_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.login_events
      (user_id, session_id, email, ip, user_agent, created_at, last_seen_at)
    select new.user_id, new.id, u.email, host(new.ip), new.user_agent,
           new.created_at, new.created_at
      from auth.users u
     where u.id = new.user_id
    on conflict (session_id) do nothing;
  else
    update public.login_events
       set last_seen_at = now()
     where session_id = new.id;
  end if;
  return new;
exception when others then
  -- A failure here would fail the sign-in itself. Never let it.
  return new;
end;
$$;

revoke execute on function public.record_login_event() from public, anon, authenticated;

drop trigger if exists on_auth_session_created on auth.sessions;
create trigger on_auth_session_created
  after insert on auth.sessions
  for each row execute function public.record_login_event();

drop trigger if exists on_auth_session_refreshed on auth.sessions;
create trigger on_auth_session_refreshed
  after update of refreshed_at on auth.sessions
  for each row
  when (new.refreshed_at is distinct from old.refreshed_at)
  execute function public.record_login_event();

-- ---- retention ---------------------------------------------------------------
select cron.unschedule('prune-login-events')
where exists (select 1 from cron.job where jobname = 'prune-login-events');

select cron.schedule(
  'prune-login-events',
  '23 * * * *',
  $$delete from public.login_events where created_at < now() - interval '180 days'$$
);

-- ---- backfill the sessions alive right now -----------------------------------
-- So the page is not empty on day one. refreshed_at is timestamp WITHOUT time
-- zone on auth.sessions; GoTrue writes it in UTC.
insert into public.login_events
  (user_id, session_id, email, ip, user_agent, created_at, last_seen_at)
select s.user_id, s.id, u.email, host(s.ip), s.user_agent, s.created_at,
       coalesce(s.refreshed_at at time zone 'utc', s.created_at)
  from auth.sessions s
  join auth.users u on u.id = s.user_id
on conflict (session_id) do nothing;

-- ============================================================================
-- RECORD THIS MIGRATION
-- ============================================================================
insert into supabase_migrations.schema_migrations (version, name)
values ('0027', 'log-every-sign-in-for-platform-admins')
on conflict (version) do nothing;
