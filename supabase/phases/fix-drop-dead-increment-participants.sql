-- Drop the dead increment_participants RPC. FEATURES.md §1.0 item 6 / §1.5 NEW-5.
--
-- Backing for the legacy src/lib/database.ts join path, which is itself dead (it
-- targets a non-existent `reviews` table and a `trek_participants.trek_id` column
-- that does not exist). Nothing live imports it. The real join path is
-- src/lib/joinTrek.ts → join_trek_and_chat().
--
-- Verified before writing this: no trigger references it (pg_trigger join pg_proc
-- → 0 rows), and its EXECUTE was already revoked from public, anon and
-- authenticated, so nothing can currently call it through PostgREST either.
--
-- ⚠️ DO NOT ALSO DROP update_participants_count(). It looks like the same thing and
-- is not: it is the live trigger function that maintains treks.participants_joined
-- (confirmed only, since follow-up #1 on 2026-06-22) — the counter Explore and
-- Favorites read. Dropping it silently freezes every participant count in the app.

drop function if exists public.increment_participants(uuid);


-- ===== VERIFY ==============================================================
-- Expect increment_participants absent and update_participants_count present:
-- select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and proname in ('increment_participants', 'update_participants_count');
--   -- expect exactly 1 row: update_participants_count
--
-- And the trigger that uses it must still be attached:
-- select tgname, tgrelid::regclass from pg_trigger
--  where tgfoid = 'public.update_participants_count()'::regprocedure;
--   -- expect at least 1 row
