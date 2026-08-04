-- =====================================================================
-- BATCH DELETE — orphaned-conversation FK guard (2026-07-15)
-- ---------------------------------------------------------------------
-- Symptom: deleteBatch() (src/lib/company.ts) failed with an opaque
--   "Error deleting batch: {}"  (PostgREST FK violation, code 23503).
--
-- Cause: join_trek_and_chat creates one conversations row per batch on the
-- first join (conversations.batch_id -> trek_batches.id, FK NO ACTION).
-- Nothing ever deletes that conversations row — leaveTrek removes only
-- conversation_participants + trek_participants. So a batch that was joined
-- and then fully vacated has ZERO participants (batch_has_participants =
-- false, the "company deletes empty batches" policy PERMITS the delete) but
-- still owns a conversations row, and the FK rejects the delete → 23503.
--
-- Fix (chosen rule: block deletion while any chat exists — no data loss,
-- honours the "never orphan a booking/chat" intent): add a SECURITY DEFINER
-- batch_has_conversation() helper and require it false in the delete policy.
-- A SECURITY DEFINER helper is REQUIRED (not an inline subquery): conversations
-- SELECT is is_chat_participant(id) — own-participation-only — so an inline
-- `not exists (... conversations)` would run under the caller's RLS and be
-- blind to a chat the deleting owner never joined, wrongly passing the guard.
-- Same reasoning as batch_has_participants (see security-fixes.sql).
--
-- After this, a vacated-but-chatted batch is blocked by RLS (0 rows, no error)
-- and deleteBatch surfaces the friendly "has bookings or chat history" message.
-- =====================================================================

create or replace function public.batch_has_conversation(p_batch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.conversations c
    where c.batch_id = p_batch_id
  );
$$;
grant execute on function public.batch_has_conversation(uuid) to authenticated;

drop policy if exists "company deletes empty batches" on public.trek_batches;
create policy "company deletes empty batches" on public.trek_batches for delete to authenticated
using (
  exists (select 1 from public.treks t where t.id = trek_batches.trek_id and public.is_company_member(t.company_id))
  and not public.batch_has_participants(trek_batches.id)
  and not public.batch_has_conversation(trek_batches.id)
);
