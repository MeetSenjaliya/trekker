-- ============================================================================
-- RATE LIMITING — Postgres-enforced (2026-08-05)
-- ✅ APPLIED + VERIFIED LIVE 2026-08-05
--    rate_events present (RLS on, 0 policies, no select for anon/authenticated);
--    both triggers created (AFTER INSERT ... FOR EACH STATEMENT on
--    conversation_messages, FOR EACH ROW on trek_participants); both enforce_*
--    functions present; invite_company_member replaced (rate guard + not_found
--    return); cron job 'prune-rate-events' scheduled '17 * * * *' (jobid 2).
-- ============================================================================
-- Run this whole file in the Supabase SQL Editor. It is idempotent.
--
-- WHY IN THE DATABASE, NOT A ROUTE HANDLER
-- The publishable key ships in the client bundle, so anything enforced in a
-- Next.js handler is bypassed by calling PostgREST directly. Only Postgres sees
-- every path, so every guard below lives in a trigger, an RLS predicate, or a
-- SECURITY DEFINER function body.
--
-- WHY TRIGGERS AND NOT RPC-BODY CHECKS
-- Most of these tables carry a *direct* client INSERT policy alongside their
-- RPC, so a guard placed only in the RPC body is skipped by inserting into the
-- table directly. Statement/row triggers fire on every path.
--
-- HOW A LIMIT IS COUNTED — two mechanisms, picked by whether evidence survives:
--   * The action leaves a durable row  -> count the real rows (no new storage).
--   * The row is deleted, or the action fails and writes nothing -> log it to
--     rate_events, which is never cleaned up by the user's own actions.
--
-- WHAT IS ALREADY BOUNDED AND NEEDS NOTHING (verified against live constraints):
--   favorites            UNIQUE (user_id, trek_id)
--   trek_reviews         UNIQUE (trek_id, user_id) + join-gated insert
--   company_members      UNIQUE (company_id, user_id)
--   trek_batches         UNIQUE (trek_id, batch_date)
--   companies            companies_one_pending_per_creator (one pending per
--                        account; re-applying needs a human admin rejection
--                        in between, so it is self-limiting)
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. rate_events — the append-only log, used only where the evidence of an
--    action does not survive (a left trek, a failed lookup).
-- ---------------------------------------------------------------------------
create table if not exists public.rate_events (
  id     bigint generated always as identity primary key,
  actor  uuid        not null references auth.users(id) on delete cascade,
  action text        not null,
  at     timestamptz not null default now()
);

create index if not exists rate_events_actor_action_at_idx
  on public.rate_events (actor, action, at desc);

-- No policies and no grants: RLS on with zero policies denies everything, and
-- the revoke removes the table from PostgREST's reach entirely. Only the
-- SECURITY DEFINER functions below (which bypass RLS) ever touch it, so a user
-- can neither read their own counter nor delete it to reset a limit.
alter table public.rate_events enable row level security;
revoke all on public.rate_events from anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. CHAT FLOOD — conversation_messages, 30 messages / minute / user
--
-- Counted from the real rows: messages are soft-deleted (is_deleted), never
-- removed, so the table is its own accurate counter and needs no log.
--
-- This is an AFTER ... FOR EACH STATEMENT trigger, NOT an RLS WITH CHECK
-- predicate. A per-row WITH CHECK cannot see the other rows of its own
-- statement, so PostgREST's bulk insert (POST an array) would pass 1000
-- messages through a row-level check that reads a count of 0 every time. An
-- AFTER STATEMENT trigger runs once the whole command is complete and sees all
-- of them. It also raises a real message, where a failed WITH CHECK would only
-- give the client an opaque 42501.
-- ---------------------------------------------------------------------------
create index if not exists conversation_messages_user_created_idx
  on public.conversation_messages (user_id, created_at desc);

create or replace function public.enforce_message_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_count int;
begin
  -- Service-role / trigger-internal writes have no auth.uid(); never block them.
  if v_uid is null then
    return null;
  end if;

  select count(*) into v_count
  from public.conversation_messages
  where user_id = v_uid and created_at > now() - interval '1 minute';

  -- The rows just inserted are already visible here, so the cap is `>`.
  -- 30/min is one message every 2s sustained — past human pace, so a real user
  -- in a busy group chat never trips it, while a flood dies immediately.
  if v_count > 30 then
    raise exception 'You are sending messages too quickly. Please wait a moment.'
      using errcode = 'P0001';
  end if;

  return null;
end;
$$;

drop trigger if exists conversation_messages_rate_limit on public.conversation_messages;
create trigger conversation_messages_rate_limit
  after insert on public.conversation_messages
  for each statement
  execute function public.enforce_message_rate_limit();


-- ---------------------------------------------------------------------------
-- 3. JOIN/LEAVE EMAIL AMPLIFICATION — trek_participants, 10 joins / hour / user
--
-- The real cost here is outbound email, not rows: trek_participants carries
-- notify_trek_participation() on INSERT *and* on DELETE, so one join/leave
-- cycle sends two emails to real people. UNIQUE (user_id, batch_id) does not
-- help, because leaving deletes the row and frees the slot to be re-used.
--
-- Logged to rate_events rather than counted from the table, precisely because
-- leaving erases the evidence.
--
-- A row trigger, not a guard inside join_trek_and_chat(): the policy
-- "Users can join treks" (with check auth.uid() = user_id) lets a client INSERT
-- into trek_participants directly and skip the RPC altogether. The trigger
-- covers both paths, and because AFTER ROW triggers see the writes of earlier
-- rows in the same statement, it also stops a single bulk insert.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_join_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_count int;
begin
  -- Waitlist promotion and other system writes run without a session.
  if v_uid is null then
    return new;
  end if;

  select count(*) into v_count
  from public.rate_events
  where actor = v_uid and action = 'join' and at > now() - interval '1 hour';

  if v_count >= 10 then
    raise exception 'You have joined too many treks in the last hour. Please try again later.'
      using errcode = 'P0001';
  end if;

  insert into public.rate_events (actor, action) values (v_uid, 'join');
  return new;
end;
$$;

drop trigger if exists trek_participants_rate_limit on public.trek_participants;
create trigger trek_participants_rate_limit
  after insert on public.trek_participants
  for each row
  execute function public.enforce_join_rate_limit();


-- ---------------------------------------------------------------------------
-- 4. ACCOUNT ENUMERATION — invite_company_member(), 20 invites / hour / user
--
-- The oracle: the function tells the caller whether an email has a Trekker
-- account. The caller must already be an owner/admin of an approved company,
-- so this is a mild leak — but unlimited, it enumerates a mailing list.
--
-- The distinct "no account found" answer is KEPT on purpose: it is the only
-- way a company admin learns they typed the address wrong, and with the probe
-- capped at 20/hour the bulk-enumeration value is gone. Left as a judgement
-- call rather than silently degraded.
--
-- CRITICAL — why "not found" now RETURNS instead of RAISING: a raised exception
-- rolls back the whole transaction, including the rate_events row that was just
-- written to record the attempt. Every failed probe would erase its own
-- evidence and the limit would count nothing. Returning a value lets the
-- transaction commit so the attempt is actually recorded.
-- ---------------------------------------------------------------------------
create or replace function public.invite_company_member(p_company_id uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_count   int;
  v_uid     uuid := auth.uid();
begin
  if not public.is_company_admin(p_company_id) then
    raise exception 'Only company owners/admins can invite members';
  end if;

  select count(*) into v_count
  from public.rate_events
  where actor = v_uid and action = 'invite' and at > now() - interval '1 hour';

  if v_count >= 20 then
    return jsonb_build_object('error', 'rate_limited');
  end if;

  insert into public.rate_events (actor, action) values (v_uid, 'invite');

  select id into v_user_id
  from public.profiles
  where lower(email) = lower(trim(p_email));

  if v_user_id is null then
    return jsonb_build_object('error', 'not_found');
  end if;

  insert into public.company_members (company_id, user_id, role)
  values (p_company_id, v_user_id, 'staff')
  on conflict (company_id, user_id) do nothing;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    return jsonb_build_object('already_member', true);
  end if;
  return jsonb_build_object('user_id', v_user_id);
end;
$$;
grant execute on function public.invite_company_member(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. PRUNING — rate_events only needs the last hour; keep a day for debugging.
-- pg_cron is already installed on this project.
-- ---------------------------------------------------------------------------
select cron.unschedule('prune-rate-events')
where exists (select 1 from cron.job where jobname = 'prune-rate-events');

select cron.schedule(
  'prune-rate-events',
  '17 * * * *',
  $$delete from public.rate_events where at < now() - interval '1 day'$$
);


-- ============================================================================
-- VERIFY — expect: 2 triggers, 1 table, 1 cron job, invite returns jsonb
-- ============================================================================
-- select tgname, tgrelid::regclass::text from pg_trigger
--  where tgname in ('conversation_messages_rate_limit','trek_participants_rate_limit');
-- select to_regclass('public.rate_events');
-- select jobname, schedule from cron.job where jobname = 'prune-rate-events';
-- select relrowsecurity from pg_class where oid = 'public.rate_events'::regclass;  -- t
-- select has_table_privilege('authenticated','public.rate_events','select');        -- f
