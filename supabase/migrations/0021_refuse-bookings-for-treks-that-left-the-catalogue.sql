-- 0021 — a frozen company's treks cannot be booked, link or no link
--
-- Phase H froze rejected/suspended tenants out of every write path they own and
-- recorded one deliberate exception: "every participant-facing flow
-- (join_trek_and_chat + the waitlist/count triggers are all SECURITY DEFINER, so
-- no existing booking or chat on a suspended company's trek is touched)". The
-- intent was to protect bookings people already held. What shipped was no
-- company check at all on the join path — which also leaves NEW bookings open.
--
-- Suspending a company only hides the catalogue. is_trek_visible() drops the
-- treks from every listing and search_treks() filters on `is_active and
-- status = 'approved'`, so the rows stop being discoverable. But
-- join_trek_and_chat() is handed a trek id and re-derives nothing from it, and a
-- trek id is not a secret: it is the /trek/[id] URL of every page the company
-- published while it was approved — in browser history, in shared links, in the
-- favourites of anyone who saved it. Paste one back after the suspension and the
-- RPC creates the batch, creates the conversation, writes a *confirmed* booking
-- and seats the buyer in the group chat, for a tenant the platform has pulled.
--
-- is_company_writable() never covered this. It answers "may this member edit
-- their own company's rows" — a buyer is not a member, and booking is not a
-- write to the tenant. There was no predicate for "may the public still buy
-- this", because until now nothing asked.
--
-- Two write paths reach a booking, so both are closed. Fixing only the RPC would
-- leave the hole open one HTTP call to the side — the same mistake 0019 and 0020
-- were written to undo.

-- ---- 1. The missing predicate ------------------------------------------------
-- Deliberately the same pair of columns is_trek_visible() and search_treks()
-- already treat as one fact — `t.is_active and c.status = 'approved'` — so
-- "bookable" cannot drift away from "publicly listed". That folds in archived
-- treks as well as frozen companies: is_active = false is the schema's only
-- delete path for a trek, and a soft-deleted trek that still takes money is the
-- same bug through the same door.
--
-- SECURITY DEFINER so it answers about companies the caller cannot read. It is a
-- yes/no on a trek id the caller already holds, so it discloses nothing a
-- suspended company's own storefront did not.
create or replace function public.is_trek_bookable(p_trek_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.treks t
    join public.companies c on c.id = t.company_id
    where t.id = p_trek_id
      and t.is_active
      and c.status = 'approved'
  );
$$;

revoke execute on function public.is_trek_bookable(uuid) from public, anon;
grant  execute on function public.is_trek_bookable(uuid) to authenticated;

-- ---- 2. join_trek_and_chat — refuse before anything is written ---------------
-- Two changes to the function, both in the guard block; everything below the
-- guards is the body as it stands.
--
--   (a) the bookability check, placed with the other caller/date guards and
--       before the first insert, so a refused join leaves behind no batch and no
--       conversation. The transaction would roll them back anyway; §14.5 made
--       the same ordering explicit for the is_trekker() guard and this follows
--       it rather than relying on that.
--
--   (b) the is_trekker() guard itself, which production has had since phase F
--       but the migrations do not: 0001 recorded it at §14.5 as a *comment*
--       describing an in-place edit, so a database rebuilt from this folder has
--       had a join RPC that accepts company accounts. Live and replayed
--       definitions agree again from here.
--
-- 'Trek not found' and 'not open for booking' stay distinct messages. Collapsing
-- them would hide a frozen trek behind "does not exist", which is worse for the
-- one person who legitimately hits this — someone holding a booking on a trek
-- whose company was frozen underneath them, re-opening the page they can still
-- see (the participant arm of is_trek_visible keeps it readable) and clicking
-- Join. They are told the trek is closed, which is true. The separation leaks
-- only "this uuid exists", to someone already holding the uuid.
--
-- The check sits ahead of the already-a-participant branch, so re-joining the
-- exact batch you already hold now raises instead of returning your membership
-- unchanged. That is the whole behaviour change for existing bookers: the
-- booking, its chat seat, and the leave path are untouched, and every other
-- entry point to the chat (Messages, the trek page's Chat button) reads
-- trek_participants directly and never calls this function.
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
  v_batch_max integer;
  v_confirmed integer;
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

  -- Lock the batch row so concurrent joins serialize on the capacity check.
  select max_participants into v_batch_max
  from public.trek_batches where id = v_batch_id for update;

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
    select count(*) into v_confirmed
    from public.trek_participants
    where batch_id = v_batch_id and status = 'confirmed';

    if v_batch_max is not null and v_confirmed >= v_batch_max then
      v_status := 'waitlisted';
    else
      v_status := 'confirmed';
    end if;

    insert into public.trek_participants (user_id, batch_id, status)
    values (v_uid, v_batch_id, v_status)
    returning id into v_participant_id;

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

-- ---- 3. RLS — the same rule on the direct insert ------------------------------
-- The backstop for `POST /rest/v1/trek_participants`, which needs only a
-- batch_id and the publishable key. §14.6 already made this policy carry
-- is_trekker() as defence in depth behind the RPC; bookability belongs beside it
-- for the same reason.
--
-- The batch hop runs under the caller's RLS, but is_trek_bookable() does not —
-- so the answer does not quietly become "whatever this user can see". A batch of
-- a bookable trek is visible to everyone by definition (is_trek_visible's public
-- arm is the same predicate), and for a frozen trek the two disagree in the safe
-- direction: an existing participant can still SELECT the batch, and is refused
-- on bookability instead.
--
-- The RPC is unaffected: SECURITY DEFINER, so it bypasses RLS and carries its
-- own check above. So do promote_waitlist_on_leave() and the count triggers —
-- a waitlisted user is still promoted after a freeze, because that seat was
-- bought while the company was approved.
drop policy if exists "Users can join treks" on public.trek_participants;
create policy "Users can join treks" on public.trek_participants for insert to authenticated
  with check (
    auth.uid() = user_id
    and public.is_trekker()
    and exists (
      select 1 from public.trek_batches tb
      where tb.id = trek_participants.batch_id
        and public.is_trek_bookable(tb.trek_id)
    )
  );

insert into supabase_migrations.schema_migrations (version, name)
values ('0021', 'refuse-bookings-for-treks-that-left-the-catalogue')
on conflict (version) do nothing;
