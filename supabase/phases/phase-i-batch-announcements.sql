-- Phase I — batch announcements.
-- FEATURES.md §1.2 "Trekker/company account split" step 5.
--
-- WHY: /messages lives under the (trekker) route group and its nav link is gated on
-- is_trekker(), and join_trek_and_chat() refuses company accounts outright — so an
-- operator currently has no way at all to reach the people who booked a departure.
--
-- SHAPE: an announcement is a row in the batch's EXISTING conversation carrying a
-- new is_announcement flag — not a separate table. That reuses realtime delivery,
-- get_unread_counts() and mark_conversation_read() unchanged, and it lands where
-- trekkers already look. A separate announcements table would have needed its own
-- RLS, its own trekker-facing surface and its own unread tracking for the same
-- outcome.
--
-- The company user is never a conversation_participant, so both the write and the
-- read-back go through SECURITY DEFINER RPCs. They stay outside the chat: they
-- cannot read trekker replies, appear in presence, or see the member list.


-- ===== 1. the flag ==========================================================
alter table public.conversation_messages
  add column if not exists is_announcement boolean not null default false;


-- ===== 2. only the RPC may set it ===========================================
-- Without this a trekker could POST to /conversation_messages through PostgREST
-- with is_announcement:true and render a forged operator notice in their own trek's
-- chat. post_batch_announcement() below is SECURITY DEFINER owned by postgres,
-- which owns this table and has NOT set FORCE ROW LEVEL SECURITY, so it bypasses
-- both policies — the tightened checks bind PostgREST clients only.
--
-- Only the added conjunct is new; the rest of each policy is reproduced verbatim
-- from the live definition.
drop policy if exists "Send messages" on public.conversation_messages;
create policy "Send messages" on public.conversation_messages
  for insert
  with check (
    user_id = auth.uid()
    and is_chat_participant(conversation_id)
    and is_announcement = false
  );

-- Closes the same forgery via edit. Side effect: it also makes a posted
-- announcement immutable through the table API, including soft-delete. Accepted
-- for v1 — the author is not a chat participant, so the messages page never offers
-- them edit/delete anyway, and a wrong announcement is corrected by posting again.
drop policy if exists "Edit own messages" on public.conversation_messages;
create policy "Edit own messages" on public.conversation_messages
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and is_announcement = false);


-- ===== 3. post ==============================================================
create or replace function public.post_batch_announcement(p_batch_id uuid, p_message text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid        uuid := auth.uid();
  v_company_id uuid;
  v_convo_id   uuid;
  v_message    text := btrim(coalesce(p_message, ''));
  v_id         uuid;
  v_created_at timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Same cap as messageSchema in src/lib/schemas.ts, restated here because the
  -- client bound is advisory only.
  if v_message = '' then
    raise exception 'Announcement cannot be empty';
  end if;
  if length(v_message) > 2000 then
    raise exception 'Announcement is too long (2000 characters max)';
  end if;

  select t.company_id into v_company_id
  from public.trek_batches tb
  join public.treks t on t.id = tb.trek_id
  where tb.id = p_batch_id;

  if v_company_id is null then
    raise exception 'Departure not found';
  end if;

  -- Approved-only. An announcement is an operational message to paying customers,
  -- so it sits at the bar for managing departures, not the looser any-member bar
  -- for reading the roster. is_approved_company_member() folds in the status check.
  if not public.is_approved_company_member(v_company_id) then
    raise exception 'You do not have permission to post announcements for this departure';
  end if;

  select id into v_convo_id from public.conversations where batch_id = p_batch_id;
  if v_convo_id is null then
    -- join_trek_and_chat() creates the conversation on the first confirmed booking.
    -- No conversation means there is nobody to announce to; creating one here would
    -- leave a chat with no members and a dangling batch_id.
    raise exception 'No one has booked this departure yet';
  end if;

  -- conversation_messages_rate_limit (AFTER STATEMENT) fires on this insert and
  -- reads auth.uid(), which is the company user here — so announcements are capped
  -- at the same 30/min as chat without any extra work.
  insert into public.conversation_messages (conversation_id, user_id, message, is_announcement)
  values (v_convo_id, v_uid, v_message, true)
  returning id, created_at into v_id, v_created_at;

  return jsonb_build_object(
    'id', v_id,
    'conversation_id', v_convo_id,
    'created_at', v_created_at
  );
end;
$$;


-- ===== 4. read back =========================================================
-- The author cannot SELECT the row they just wrote (conversation_messages SELECT is
-- is_chat_participant()), so the dashboard needs its own read path.
create or replace function public.get_batch_announcements(p_batch_id uuid)
returns table (
  id uuid,
  message text,
  created_at timestamptz,
  author_id uuid,
  author_name text
)
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_company_id uuid;
begin
  select t.company_id into v_company_id
  from public.trek_batches tb
  join public.treks t on t.id = tb.trek_id
  where tb.id = p_batch_id;

  -- Reading matches the roster bar (any member — a frozen company can still review
  -- what it sent); posting is stricter. Silent empty on no access, mirroring
  -- get_company_batch_participants().
  if v_company_id is null or not public.is_company_member(v_company_id) then
    return;
  end if;

  return query
  select m.id, m.message, m.created_at, m.user_id, p.full_name
  from public.conversation_messages m
  join public.conversations c on c.id = m.conversation_id
  left join public.profiles p on p.id = m.user_id
  where c.batch_id = p_batch_id
    and m.is_announcement
    and coalesce(m.is_deleted, false) = false
  order by m.created_at desc;
end;
$$;


-- ===== 5. grants ============================================================
-- Both are new, so they would otherwise land with the default PUBLIC execute grant
-- and immediately re-open the anon_security_definer_function_executable lint that
-- fix-anon-execute-definer-rpcs.sql just closed. Same revoke+regrant shape.
revoke execute on function public.post_batch_announcement(uuid, text) from public, anon;
grant  execute on function public.post_batch_announcement(uuid, text) to authenticated;

revoke execute on function public.get_batch_announcements(uuid) from public, anon;
grant  execute on function public.get_batch_announcements(uuid) to authenticated;


-- ===== VERIFY ===============================================================
-- 1. Column exists and defaults false:
-- select column_name, data_type, column_default, is_nullable
--   from information_schema.columns
--  where table_schema='public' and table_name='conversation_messages'
--    and column_name='is_announcement';
--   -- expect: boolean, false, NO
--
-- 2. The anon lint stays at exactly 3 (the load-bearing trio), NOT 5:
-- select p.proname
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname='public' and p.prosecdef
--    and has_function_privilege('anon', p.oid, 'execute')
--  order by 1;
--   -- expect: is_company_member, is_platform_admin, is_trek_visible
--
-- 3. Both policies carry the new conjunct:
-- select policyname, with_check from pg_policies
--  where schemaname='public' and tablename='conversation_messages'
--    and policyname in ('Send messages','Edit own messages');
--   -- expect is_announcement = false in both with_check clauses
--
-- 4. Forgery is blocked (run as a signed-in TREKKER who is in some batch chat):
-- insert into public.conversation_messages (conversation_id, user_id, message, is_announcement)
-- values ('<a conversation they belong to>', auth.uid(), 'forged', true);
--   -- expect: new row violates row-level security policy
--   -- and the same insert with is_announcement default (omitted) must SUCCEED.
--
-- 5. Post as a company member of an approved company with >=1 booking:
-- select public.post_batch_announcement('<batch id>', 'Meeting point moved to the north gate.');
--   -- expect jsonb with id/conversation_id/created_at
-- select * from public.get_batch_announcements('<batch id>');
--   -- expect that row back, author_name populated
--   -- and the booked trekker's /messages shows it with an unread badge.
--
-- 6. Controls — each must fail or return empty:
--   - post to a batch of a company you are NOT a member of  -> permission error
--   - post to a batch whose company is pending/suspended    -> permission error
--   - post to a batch with no bookings yet                  -> 'No one has booked...'
--   - get_batch_announcements as a non-member               -> 0 rows
