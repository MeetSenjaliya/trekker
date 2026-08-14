-- ============================================================================
-- PERF — chat hot-path indexes + unindexed FKs (2026-08-12)
-- ============================================================================
-- ✅ APPLIED + VERIFIED LIVE 2026-08-12. All four indexes present, exactly one
-- unique left on conversation_participants, and the only unindexed FKs the
-- verify query still returns are the two under "Deliberately NOT done".
-- `set enable_seqscan = off` + explain confirms Index Scan using
-- conversation_messages_conv_created_idx with the conversation_id Index Cond
-- and NO Sort node. Re-running this file is a no-op.
--
-- ⚠️ Confirm the SQL Editor tab is on project dtjmyqogeozrzzbdjokr first:
--    select current_database(), to_regclass('public.rate_events');
--
-- Verified live via read-only MCP before writing this file:
--   conversation_messages had ONLY  (created_at, id) pkey  and  (user_id, created_at desc)
--   conversation_participants had TWO byte-identical uniques on (conversation_id, user_id)
--   unindexed FKs: conversation_messages.conversation_id, conversation_participants.user_id,
--                  favorites.trek_id, trek_reviews.user_id
--
-- NOT concurrently, on purpose: every table here is under 100 rows today, so a
-- plain CREATE INDEX is a few milliseconds, and CREATE INDEX CONCURRENTLY
-- cannot run inside a transaction block — which is how the SQL Editor submits
-- a multi-statement script. If this file is ever re-run against a large
-- conversation_messages, split it and run each CONCURRENTLY on its own.
--
-- Idempotent: `if not exists` / `if exists` make re-running a no-op.
-- ============================================================================


-- ---- 1. conversation_messages (conversation_id, created_at desc) -------------
-- The actual message read is
--   src/app/(trekker)/messages/page.tsx:169  fetchMessagesPage()
--     .eq('conversation_id', id).order('created_at', desc).limit(30)
--     .lt('created_at', cursor)   -- older-page cursor
-- i.e. equality on conversation_id, then a descending range + LIMIT on
-- created_at. Neither existing index leads with conversation_id, so this was a
-- full scan of the fastest-growing table on every conversation open and every
-- scroll-back page. Column order matters: (conversation_id, created_at desc)
-- turns the whole thing into one index range scan that stops after 30 rows;
-- (created_at, conversation_id) would not.
--
-- Also the inner half of get_unread_counts() (§5), which runs on every page
-- load for the unread badge — it counts m.created_at > cp.last_read_at per
-- conversation, the same (conversation_id, created_at) shape.
create index if not exists conversation_messages_conv_created_idx
  on public.conversation_messages (conversation_id, created_at desc);


-- ---- 2. conversation_participants (user_id, conversation_id) -----------------
-- Both pre-existing indexes lead with conversation_id, so "which conversations
-- am I in?" had no usable index. Two hot callers:
--   src/app/(trekker)/messages/page.tsx:125  .select('conversation_id').eq('user_id', user.id)
--   get_unread_counts() (§5)                 cp.user_id = auth.uid()  -- the driving side
-- Fixes the unindexed conversation_participants_user_id_fkey at the same time,
-- so profile deletes stop scanning the table per cascade.
-- Covering: both callers select only conversation_id, so this answers them
-- index-only.
create index if not exists conversation_participants_user_conv_idx
  on public.conversation_participants (user_id, conversation_id);


-- ---- 3. favorites (trek_id) --------------------------------------------------
-- favorites_user_id_trek_id_key leads with user_id, which serves "my
-- favourites" but not the FK. Without this, deleting a trek scans favorites.
create index if not exists favorites_trek_idx
  on public.favorites (trek_id);


-- ---- 4. trek_reviews (user_id) -----------------------------------------------
-- trek_reviews_trek_id_user_id_key leads with trek_id, so per-trek review reads
-- are covered but "reviews by this user" and the profiles cascade are not.
create index if not exists trek_reviews_user_idx
  on public.trek_reviews (user_id);


-- ---- 5. Drop the duplicate UNIQUE on conversation_participants ---------------
-- Supersedes supabase/phases/fix-duplicate-participant-unique.sql (2026-08-05,
-- written but never applied — the duplicate is still live). Folded in here so
-- the whole hot path is one paste.
--
-- TWO identical unique constraints exist on (conversation_id, user_id):
--   conversation_participants_conv_user_key                <- named in schema.sql:175
--   conversation_participants_conversation_id_user_id_key  <- Postgres default name
-- Both btrees are maintained on every chat join for one guarantee. Safe to drop
-- either: every `on conflict (conversation_id, user_id)` in the codebase
-- (join_trek_and_chat §5, promote_waitlist_on_leave §5) infers the arbiter from
-- the COLUMN LIST, not a constraint name, and no FK targets either constraint
-- (checked: nothing references conversation_participants). Keep the
-- schema.sql-documented name.
alter table public.conversation_participants
  drop constraint if exists conversation_participants_conversation_id_user_id_key;


-- ---- Deliberately NOT done ---------------------------------------------------
-- trek_batches.trek_id — already covered by trek_batches_trekid_batchdate_key
--   (trek_id, batch_date); a leading-column prefix is usable, so a standalone
--   index on trek_id would be pure write overhead. (CODE_REVIEW item 6's
--   suggested SQL includes this one — skip it.)
-- companies.approved_by / company_invites.invited_by — genuinely unindexed FKs,
--   but 4 rows each and only touched on platform-admin approval paths. Revisit
--   if either table reaches five figures.


-- ---- Verify ------------------------------------------------------------------
-- (a) Expect the four new indexes present.
select tablename, indexname
from pg_indexes
where schemaname = 'public'
  and indexname in ('conversation_messages_conv_created_idx',
                    'conversation_participants_user_conv_idx',
                    'favorites_trek_idx',
                    'trek_reviews_user_idx')
order by tablename;

-- (b) Expect exactly ONE row: conversation_participants_conv_user_key
select conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = 'public.conversation_participants'::regclass
  and contype = 'u';

-- (c) Expect only companies_approved_by_fkey and company_invites_invited_by_fkey
--     to remain (see "Deliberately NOT done").
select c.conrelid::regclass::text as tbl, c.conname
from pg_constraint c
join pg_class t on t.oid = c.conrelid
join pg_namespace n on n.oid = t.relnamespace
where c.contype = 'f' and n.nspname = 'public'
  and not exists (
    select 1 from pg_index i
    where i.indrelid = c.conrelid
      and (i.indkey::int2[])[0:array_length(c.conkey,1)-1] = c.conkey
  )
order by 1, 2;

-- (d) Expect an Index Scan (not Seq Scan) on conversation_messages_conv_created_idx.
--     Substitute a real conversation id.
-- explain analyze
-- select * from public.conversation_messages
--  where conversation_id = '00000000-0000-0000-0000-000000000000'
--  order by created_at desc limit 30;
