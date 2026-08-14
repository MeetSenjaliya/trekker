-- ============================================================================
-- FIX — drop the duplicate UNIQUE on conversation_participants (2026-08-05)
-- ============================================================================
-- ⚠️ SUPERSEDED (2026-08-12) — this was never applied. The same drop is folded
-- into supabase/phases/perf-chat-hot-path-indexes.sql §5. Run that file
-- instead; running this one too is a harmless no-op.
-- ============================================================================
-- ⚠️ Confirm the SQL Editor tab is on project dtjmyqogeozrzzbdjokr first:
--    select current_database(), to_regclass('public.rate_events');
--
-- Problem: conversation_participants carries TWO identical unique constraints
-- on (conversation_id, user_id):
--   conversation_participants_conv_user_key                 <- named in schema.sql
--   conversation_participants_conversation_id_user_id_key   <- Postgres default name
-- Both are enforced on every write, so each chat join maintains two identical
-- btrees for no benefit.
--
-- Safe to drop either one: every `on conflict (conversation_id, user_id)` in
-- the codebase (join_trek_and_chat §5, promote_waitlist_on_leave §5) infers the
-- arbiter from the COLUMN LIST, not a constraint name, so the remaining index
-- serves them unchanged. Keep the schema.sql-documented name.
--
-- Idempotent: `if exists` makes re-running a no-op.
-- ============================================================================

alter table public.conversation_participants
  drop constraint if exists conversation_participants_conversation_id_user_id_key;


-- ---- Verify -----------------------------------------------------------------
-- Expect exactly ONE row: conversation_participants_conv_user_key
select conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = 'public.conversation_participants'::regclass
  and contype = 'u';

-- Expect the join path to still work (run as a normal signed-in user, not here):
--   the uniqueness guarantee is unchanged — a second join to the same
--   conversation still hits `on conflict ... do nothing`.
