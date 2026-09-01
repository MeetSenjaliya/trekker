-- ============================================================================
-- 0004 — realtime.messages: private chat channel authorization (record only)
-- ============================================================================
-- messages/page.tsx opens `conversation:${id}` with `{ private: true }` for two
-- things: presence (who's online) and a `typing` broadcast. Supabase private
-- channels are authorized by RLS on realtime.messages — a table this repo
-- never touched, which is what REALTIME-002/003 (2026-08-24 pentest) flagged.
--
-- realtime.messages is owned by supabase_realtime_admin, not postgres. Verified
-- live (read-only MCP, 2026-08-25): `postgres` holds no membership in
-- supabase_realtime_admin (`select rolname from pg_auth_members ... where
-- member = 'postgres'::regrole` — anon/authenticated/service_role and a few
-- admin roles, no supabase_realtime_admin). That means `alter table
-- realtime.messages enable row level security` and `create policy ... on
-- realtime.messages` can NEVER be run from the SQL Editor on this — or any —
-- Supabase project: it fails with `must be owner of table messages` by
-- platform design, not a grant this repo revoked. The only supported path is
-- the Dashboard: Database → Realtime → Policies.
--
-- That path was already used, before this migration existed: querying
-- pg_class/pg_policy live shows realtime.messages already has RLS enabled and
-- two policies — "chat members read conversation channel" (select) and "chat
-- members write conversation channel" (insert) — both `to authenticated`,
-- both gated on `('conversation:' || conversations.id) = realtime.topic() and
-- is_chat_participant(conversations.id)`. REALTIME-002/003 is closed in
-- production. This file exists only to:
--
--   1. Record that fact in version control (nothing else in the repo mentions
--      realtime.messages, and CLAUDE.md is explicit that DB state undocumented
--      here is state nobody can reason about).
--   2. Let tests/db (PGlite, connected as an actual superuser — the ownership
--      restriction above is a hosted-Supabase-only boundary) replay the same
--      protection, so `tests/db/chat.test.ts` can assert it behaviourally
--      instead of everyone trusting a comment.
--
-- Do NOT paste the ALTER TABLE / CREATE POLICY statements below into the SQL
-- Editor against production — they will fail with "must be owner of table
-- messages" exactly as they did the first time this was tried. Only the
-- ledger INSERT at the bottom targets a table this repo actually owns
-- (supabase_migrations.schema_migrations); running just that (optional —
-- bookkeeping only, changes no access rules) records the version. To change
-- these policies going forward, use the Dashboard, then update this file to
-- match and re-record it the way 0002 documents an already-applied change.

alter table realtime.messages enable row level security;

drop policy if exists "chat members read conversation channel" on realtime.messages;
create policy "chat members read conversation channel" on realtime.messages
  for select to authenticated
  using (exists (
    select 1 from public.conversations c
    where 'conversation:' || c.id::text = realtime.topic()
      and public.is_chat_participant(c.id)
  ));

drop policy if exists "chat members write conversation channel" on realtime.messages;
create policy "chat members write conversation channel" on realtime.messages
  for insert to authenticated
  with check (exists (
    select 1 from public.conversations c
    where 'conversation:' || c.id::text = realtime.topic()
      and public.is_chat_participant(c.id)
  ));

-- ============================================================================
-- RECORD THIS MIGRATION
-- ============================================================================
insert into supabase_migrations.schema_migrations (version, name)
values ('0004', 'realtime-private-channel-authorization')
on conflict (version) do nothing;
