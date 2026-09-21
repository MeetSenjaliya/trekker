-- 0024 — a booking's status comes from the seat count, not from the client
--
-- join_trek_and_chat() decides confirmed-or-waitlisted under a lock on the
-- batch row, then writes the row. The "Users can join treks" policy, which is
-- all that stands between `POST /rest/v1/trek_participants` and the table,
-- pins user_id (auth.uid()), the account kind (is_trekker(), §14.6) and the
-- trek's bookability (0021) — and says nothing about status. So the capacity
-- check bound only the clients that chose to call the RPC: a direct insert
-- with `status = 'confirmed'` on a full departure took a seat the RPC would
-- have waitlisted, and one with no status at all took the same seat by
-- default. 0020 found this while pinning joined_at and left it, because a
-- guard on status has to agree with the waitlist rather than sit beside it.
--
-- Swept 2026-09-09: no batch carries more confirmed bookings than
-- max_participants, so this was open, not exploited.
--
-- The fix is the same shape as 0020's joined_at: a BEFORE INSERT trigger that
-- overwrites the column with the value the database computes, so every insert
-- path — RPC or bare POST — lands the row with the status the seat count
-- allows. A rewrite, not a refusal, for two reasons:
--
--   * refusing would make a plain POST fail where the RPC waitlists, i.e. the
--     honest answer to "the batch is full" is a waitlisted row, and that is
--     what the RPC has always returned; and
--   * a WITH CHECK arm on the policy cannot do this job: Postgres evaluates it
--     on the row AFTER BEFORE triggers ran, so it would only ever see the
--     trigger's value; and counting seats under the caller's RLS would see the
--     caller's own rows alone (SELECT is own-row-only, NEW-4), so the count
--     needs definer rights the policy does not have.
--
-- With the trigger authoritative, the RPC's own copy of the decision is a
-- second implementation of one rule — the drift 0022 had to repair between the
-- RPC's queue numbering and the trigger's queue order. It is removed: the RPC
-- inserts without a status and reads back the one the trigger assigned, so the
-- chat seat and the returned status follow the row that was actually written.

-- ---- 1. status is decided when the row is written -----------------------------
-- SECURITY DEFINER because the count spans other users' rows, which the
-- caller's RLS hides. Same reason enforce_join_rate_limit() and
-- promote_waitlist_on_leave() are definer triggers on this table.
--
-- Writes with no session keep the status they wrote — the SQL Editor, seeding,
-- pg_cron. That is the branch protect_profile_account_type() takes for the same
-- writers, and it keeps the Editor usable for a manual repair. A client cannot
-- reach it: the INSERT policy is `to authenticated` and requires
-- auth.uid() = user_id, so a NULL auth.uid() never gets as far as this trigger.
create or replace function public.assign_participant_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_max       integer;
  v_confirmed integer;
begin
  if auth.uid() is null then
    return new;
  end if;

  -- The lock join_trek_and_chat() takes, taken here so two inserts on one
  -- batch serialize on the count whichever path they arrive by. Inside the RPC
  -- this re-locks a row the transaction already holds, which is a no-op.
  select max_participants into v_max
  from public.trek_batches
  where id = new.batch_id
  for update;

  select count(*) into v_confirmed
  from public.trek_participants
  where batch_id = new.batch_id and status = 'confirmed';

  -- NULL max_participants is "uncapped" (0017).
  if v_max is not null and v_confirmed >= v_max then
    new.status := 'waitlisted';
  else
    new.status := 'confirmed';
  end if;

  return new;
end;
$$;

revoke all on function public.assign_participant_status() from public, anon, authenticated;

-- Fires before trek_participants_pin_joined_at (name order, 'a' < 'p'). The
-- two set different columns, so the order is stated, not load-bearing.
drop trigger if exists trek_participants_assign_status on public.trek_participants;
create trigger trek_participants_assign_status
  before insert on public.trek_participants
  for each row execute function public.assign_participant_status();

-- ---- 2. join_trek_and_chat — read the decision back instead of making it ---
-- The body is 0021's with the capacity block taken out: v_batch_max and
-- v_confirmed are gone, the batch lock stays (it also serializes the
-- already-a-participant check, so a double submit from one user finds its
-- first row instead of tripping the unique constraint), and the insert no
-- longer passes a status. Everything else — the guards, the batch and
-- conversation upserts, the position count, the return shape — is unchanged.
create or replace function public.join_trek_and_chat(
  p_user_id uuid,
  p_trek_id uuid,
  p_batch_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_batch_id uuid;
  v_convo_id uuid;
  v_participant_id uuid;
  v_trek_title text;
  v_trek_max integer;
  v_status text;
  v_position integer := null;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  -- Require the caller to act as themselves (closes the NULL p_user_id bypass).
  if p_user_id is null or p_user_id <> v_uid then
    raise exception 'p_user_id must equal the authenticated user';
  end if;

  -- Company accounts sell treks, they don't book them.
  if not public.is_trekker() then
    raise exception 'Company accounts cannot join treks';
  end if;

  -- Bound batch/conversation creation (DoS guard).
  if p_batch_date is null then
    raise exception 'Batch date is required';
  end if;
  if p_batch_date < current_date - interval '1 day' then
    raise exception 'Cannot join a trek batch in the past';
  end if;
  if p_batch_date > current_date + interval '1 year' then
    raise exception 'Batch date is too far in the future';
  end if;

  select title, max_participants into v_trek_title, v_trek_max
  from public.treks where id = p_trek_id;
  if v_trek_title is null then
    raise exception 'Trek not found';
  end if;

  -- Archived, or the owning company is no longer approved. Holding the link is
  -- not permission to buy.
  if not public.is_trek_bookable(p_trek_id) then
    raise exception 'This trek is not open for booking';
  end if;

  insert into public.trek_batches (trek_id, batch_date, max_participants)
  values (p_trek_id, p_batch_date, v_trek_max)
  on conflict (trek_id, batch_date) do nothing
  returning id into v_batch_id;
  if v_batch_id is null then
    select id into v_batch_id from public.trek_batches
    where trek_id = p_trek_id and batch_date = p_batch_date limit 1;
  end if;

  -- Lock the batch row so concurrent joins serialize from here down. The seat
  -- itself is decided by assign_participant_status() when the row is written.
  perform 1 from public.trek_batches where id = v_batch_id for update;

  insert into public.conversations (batch_id, name)
  values (v_batch_id, (v_trek_title || ' — ' || p_batch_date::text))
  on conflict (batch_id) do nothing
  returning id into v_convo_id;
  if v_convo_id is null then
    select id into v_convo_id from public.conversations
    where batch_id = v_batch_id limit 1;
  end if;

  -- Already a participant? Return the existing membership unchanged.
  select id, status into v_participant_id, v_status
  from public.trek_participants
  where user_id = v_uid and batch_id = v_batch_id;

  if v_participant_id is null then
    insert into public.trek_participants (user_id, batch_id)
    values (v_uid, v_batch_id)
    returning id, status into v_participant_id, v_status;

    -- Only confirmed participants get a seat in the batch chat.
    if v_status = 'confirmed' then
      insert into public.conversation_participants (conversation_id, user_id)
      values (v_convo_id, v_uid)
      on conflict (conversation_id, user_id) do nothing;
    end if;
  end if;

  if v_status = 'waitlisted' then
    select count(*) into v_position
    from public.trek_participants
    where batch_id = v_batch_id
      and status = 'waitlisted'
      and (joined_at, id) <= (
        select joined_at, id from public.trek_participants where id = v_participant_id
      );
  end if;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'participant_id', v_participant_id,
    'conversation_id', v_convo_id,
    'status', v_status,
    'waitlist_position', v_position
  );
end;
$$;

insert into supabase_migrations.schema_migrations (version, name)
values ('0024', 'decide-the-seat-when-the-booking-is-written')
on conflict (version) do nothing;
