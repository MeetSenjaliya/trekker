-- Tighten post_batch_announcement(): refuse when the chat has no members.
-- FEATURES.md §2 "Account types → 5" — follow-up from the 2026-08-12 behavioural run.
--
-- WHY: the guard tested whether a `conversations` row EXISTS, and that row outlives
-- every participant. join_trek_and_chat() creates it on the first confirmed booking
-- and leaveTrek() clears only conversation_participants — the same fact behind the
-- "a departure can't be deleted once anyone has ever joined" gotcha. So a departure
-- everyone has left still accepted an announcement and returned success, writing a
-- row into a chat with zero readers. 10 of 17 batches were in that state on
-- 2026-08-12. Not a leak — a silent no-op the operator is told succeeded.
--
-- The two cases keep separate messages because they are different facts about the
-- departure and the client surfaces the P0001 text verbatim: "nobody has booked" is
-- untrue of a departure five people booked and then left.
--
-- Only the second `if` block is new; the rest is the live definition verbatim.
-- CREATE OR REPLACE preserves the ACL, so the revoke/grant pair from
-- phase-i-batch-announcements.sql §5 carries over untouched (verified below).

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

  -- The conversation outlives its members, so existence is not readership.
  if not exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = v_convo_id
  ) then
    raise exception 'Everyone has left this departure — there is no one to announce to';
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


-- ===== VERIFY ===============================================================
-- Run each block as its own script, whole thing at once: the editor shows only the
-- last statement's result, and a deliberate error aborts everything after it.
-- Both blocks roll back.
--
-- 1. Grants survived the replace (expect anon=false, authenticated=true):
-- select has_function_privilege('anon','public.post_batch_announcement(uuid,text)','execute') as anon,
--        has_function_privilege('authenticated','public.post_batch_announcement(uuid,text)','execute') as authenticated;
--
-- 2. NEGATIVE — vacated departure (conversation exists, zero participants).
--    4d552303 = Hampta Pass 2026-09-02, conversation 68f561b8, 0 participants.
-- begin;
-- set local request.jwt.claims = '{"sub":"655b4188-d194-4529-8114-e86c66d3d8ae","role":"authenticated"}';
-- set local role authenticated;
-- select public.post_batch_announcement('4d552303-b6b6-4d62-aebb-151d93935c19', 'empty-chat control');
-- rollback;
--   -- expect: Everyone has left this departure — there is no one to announce to
--
-- 3. POSITIVE — same caller, same company, a departure that HAS a member.
--    Without this the refusal above is equally consistent with a broken function.
--    6ca0930b = Desert Sands 2026-08-30, conversation 6ed1fc78, 1 participant.
-- begin;
-- set local request.jwt.claims = '{"sub":"655b4188-d194-4529-8114-e86c66d3d8ae","role":"authenticated"}';
-- set local role authenticated;
-- select public.post_batch_announcement('6ca0930b-ca94-4775-b05a-daa86631779c', 'positive control');
-- rollback;
--   -- expect: jsonb with id/conversation_id/created_at
--
-- 4. The other three refusals are unchanged and stay covered by
--    phase-i-batch-announcements.sql block 6.
