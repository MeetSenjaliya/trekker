-- ============================================================================
-- 0012 — move the 10/hour notification-email cap out of the edge functions
--        and into Postgres
-- ============================================================================
-- `send-trek-notification` and `send-trek-leave-notification` cap outbound mail
-- at 10/hour per recipient (EDGE-003). Until now that cap lived entirely in
-- TypeScript: both functions counted `rate_events` rows themselves and decided
-- whether to send. Two holes in that shape:
--
--   * It is a policy the caller enforces on itself. Both functions hold the
--     SECRET key, which bypasses RLS on `rate_events`, so the count is advisory
--     — anything holding that key (a future revision of either function, a
--     leaked secret used against PostgREST directly) can mail without counting.
--   * Check-then-insert is not atomic. Ten concurrent webhook calls each read
--     a count of 9 and each send; the real cap was "10 + concurrency".
--
-- A BEFORE INSERT trigger on the log table closes both: the insert IS the
-- gate, so no send can be recorded without being counted, and an advisory lock
-- keyed on the recipient serialises the read-modify-write so concurrent callers
-- queue instead of racing.
--
-- The log table is `rate_events` rather than a new one: it already is the
-- dedicated rate-limit log (0001 §13.1 — zero policies, zero client grants,
-- pruned hourly by pg_cron), and both functions already share the one
-- 'trek_email' action so alternating endpoints cannot double the rate. A second
-- table would need its own index, RLS, prune job and would split that counter
-- in two. The trigger is scoped with WHEN so the other actions ('join',
-- 'invite', 'avatar', …) are untouched.
--
-- The functions still count: 0012 does not replace their check, it makes the
-- insert the authority. The deployed functions insert AFTER deciding to send,
-- which under this trigger would let the 10th email through and raise on the
-- 11th attempt; they are updated in the same change to insert first and treat
-- P0001 as their 429.

create or replace function public.enforce_trek_email_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  -- Serialise per recipient. Without this two concurrent inserts both read the
  -- same pre-cap count and both succeed; the lock is held to end of transaction
  -- and only ever contends with another email for the same user.
  perform pg_advisory_xact_lock(hashtextextended('trek_email:' || new.actor::text, 0));

  select count(*) into v_count
  from public.rate_events
  where actor = new.actor
    and action = 'trek_email'
    and at > now() - interval '1 hour';

  if v_count >= 10 then
    raise exception 'Too many trek notification emails for this recipient in the last hour.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists rate_events_trek_email_rate_limit on public.rate_events;
create trigger rate_events_trek_email_rate_limit
  before insert on public.rate_events
  for each row
  when (new.action = 'trek_email')
  execute function public.enforce_trek_email_rate_limit();

-- Mirror §17.4 of 0001: Postgres checks EXECUTE at CREATE TRIGGER time, not when
-- the trigger fires, so no caller needs the grant. The default PUBLIC grant is
-- what would otherwise put a new SECURITY DEFINER function on anon's list.
revoke execute on function public.enforce_trek_email_rate_limit() from public, anon;

-- ============================================================================
-- RECORD THIS MIGRATION
-- ============================================================================
insert into supabase_migrations.schema_migrations (version, name)
values ('0012', 'enforce-trek-email-rate-limit-in-postgres')
on conflict (version) do nothing;
