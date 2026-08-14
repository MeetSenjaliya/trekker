-- ⚠️ SUPERSEDED by supabase/migrations/0002_trek-returning-and-chat-policy-roles.sql.
-- This file is what was actually pasted into the SQL Editor on 2026-08-13, kept
-- as the historical record. Do not run it — run the migration, which carries the
-- same SQL plus its ledger row. Everything below is retained for its rationale.
--
-- Two policy fixes found by tests/db/ on 2026-08-13.
-- FEATURES.md §1.7 (createTrek RETURNING) and §1.8 (chat policy roles).
--
-- Neither change grants any visibility that did not already exist.


-- ===== A. createTrek() — INSERT … RETURNING is rejected =====================
--
-- `INSERT … RETURNING` applies the table's SELECT policy to the returned row.
-- "view treks" is `is_trek_visible(id)`, and is_trek_visible is STABLE with a
-- body of `select 1 from public.treks t join public.companies c … where t.id = $1`.
-- A STABLE function sees the snapshot from the START of the calling statement,
-- so it cannot see the row that same statement is inserting. It returns false,
-- the returned row fails the SELECT check, and the INSERT is rejected with
-- `new row violates row-level security policy for table "treks"` — an error
-- that reads like a with_check failure and sends you to the wrong policy.
--
-- src/lib/company.ts:345 is `.insert({...}).select('id').single()`, which
-- PostgREST compiles to exactly that. So no company can publish a trek, and it
-- fails for platform admins too: the `or is_platform_admin()` arm sits INSIDE
-- the same unsatisfiable FROM clause.
--
-- ⚠️ The obvious fix is wrong. Adding the arm to "view treks" itself —
--       using (is_trek_visible(id) or is_approved_company_member(company_id))
--    would take the public site down. "view treks" is `to public`, which
--    includes anon, and is_approved_company_member is revoked from anon
--    (schema.sql §17.3). Every anonymous /explore and /trek/[id] read would
--    raise `permission denied for function is_approved_company_member`. This is
--    the same trap as the load-bearing trio in FEATURES.md Known Gotchas.
--
-- Instead: a SECOND permissive policy scoped `to authenticated`. Postgres only
-- applies policies whose roles include the current role, so anon never
-- evaluates it, and permissive policies on the same command are OR'd together.
-- The predicate reads company_members/companies and never treks, so it has no
-- snapshot dependency and is satisfied by the new row's own company_id.
--
-- This grants NOTHING new. is_trek_visible already contains
-- `or public.is_company_member(t.company_id)`, which is not status-gated; this
-- policy uses is_approved_company_member, which is strictly narrower. It exists
-- only to be evaluable during INSERT … RETURNING.

drop policy if exists "company members view own treks" on public.treks;
create policy "company members view own treks" on public.treks for select to authenticated
using (public.is_approved_company_member(company_id));


-- ===== B. chat policies: to public → to authenticated =======================
--
-- The chat policies are declared `to public`, which includes anon, but their
-- quals call is_chat_participant() — which anon does NOT hold EXECUTE on
-- (schema.sql §17.5). An anonymous read of conversation_messages therefore
-- raises `permission denied for function is_chat_participant` instead of
-- returning an empty set.
--
-- It fails closed and nothing in the app reads chat anonymously, so this is
-- tidiness rather than exposure. Re-scoping to `authenticated` makes the
-- denial an ordinary empty result.
--
-- ONLY the four policies that actually call is_chat_participant() are touched.
-- Deliberately left as `to public`:
--   "System adds participants"    — with_check is auth.role() = 'service_role';
--                                   re-scoping to authenticated would exclude
--                                   the only role it is meant to admit.
--   "Users can leave conversation" / "Edit own messages" / "Delete own messages"
--                                 — these test user_id = auth.uid(), which is
--                                   already NULL for anon, and they call no
--                                   revoked function. Nothing to fix.

drop policy if exists "Users can view their conversations" on public.conversations;
create policy "Users can view their conversations" on public.conversations
  for select to authenticated using (public.is_chat_participant(id));

drop policy if exists "Users can view participants of their chats" on public.conversation_participants;
create policy "Users can view participants of their chats" on public.conversation_participants
  for select to authenticated using (public.is_chat_participant(conversation_id));

drop policy if exists "Read messages of joined conversations" on public.conversation_messages;
create policy "Read messages of joined conversations" on public.conversation_messages
  for select to authenticated using (public.is_chat_participant(conversation_id));

drop policy if exists "Send messages" on public.conversation_messages;
create policy "Send messages" on public.conversation_messages
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_chat_participant(conversation_id)
    and is_announcement = false
  );


-- ===== C. Verify ============================================================
-- Expect: treks has TWO select policies, one {public} one {authenticated};
-- the four chat policies below all show {authenticated}.
select tablename, policyname, cmd, roles::text
  from pg_policies
 where schemaname = 'public'
   and (
     (tablename = 'treks' and cmd = 'SELECT')
     or policyname in (
       'Users can view their conversations',
       'Users can view participants of their chats',
       'Read messages of joined conversations',
       'Send messages'
     )
   )
 order by tablename, policyname;
