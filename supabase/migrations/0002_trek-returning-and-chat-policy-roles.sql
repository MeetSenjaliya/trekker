-- ============================================================================
-- 0002 — createTrek() RETURNING fix + chat policy role scoping
-- ============================================================================
-- Both changes were applied to production on 2026-08-13, shortly after 0001,
-- via phases/fix-trek-returning-and-chat-policy-roles.sql. They are recorded
-- here as their own migration so the ledger reflects what actually ran, in the
-- order it ran. Re-running this file against production is a no-op: every
-- statement is `drop policy if exists` + `create policy`, and the resulting
-- definitions match what is already live.
--
-- Found by tests/db/catalogue-writes.test.ts. Neither change grants any
-- visibility that did not already exist.
--
-- Rationale in full: FEATURES.md §1.7 and §1.8.


-- ===== A. treks — a second SELECT policy so INSERT … RETURNING can pass ======
--
-- `insert … returning` applies the table's SELECT policy to the new row.
-- "view treks" is `using (public.is_trek_visible(id))`, and is_trek_visible is
-- STABLE with a body that reads public.treks — so it evaluates against the
-- snapshot taken at the start of the statement and cannot see the row that same
-- statement is inserting. The predicate returns false, the returned row fails
-- the SELECT check, and the INSERT is rejected with `new row violates row-level
-- security policy for table "treks"` — an error that reads like a with_check
-- failure and sends you to the wrong policy.
--
-- src/lib/company.ts createTrek() is `.insert({...}).select('id').single()`,
-- which PostgREST compiles to exactly that, so no company could publish a trek.
-- It failed for platform admins too: the `or is_platform_admin()` arm sits
-- inside the same unsatisfiable FROM clause. createBatch() was unaffected — it
-- inserts without `.select()`.
--
-- ⚠️ Do NOT fold this into "view treks" as an `or` arm instead. That policy is
-- `to public`, which includes anon, and is_approved_company_member is revoked
-- from anon (0001 §17.3) — every anonymous /explore and /trek/[id] read would
-- raise `permission denied for function is_approved_company_member`. Same trap
-- as the load-bearing trio in FEATURES.md Known Gotchas.
--
-- A second permissive policy scoped `to authenticated` avoids that: Postgres
-- only applies policies whose roles include the current role, so anon never
-- evaluates this one, and permissive policies on the same command are OR'd.
--
-- Grants no new visibility: is_trek_visible already carries
-- `or is_company_member(t.company_id)` with no status gate, and this is the
-- strictly narrower approved-only form. It exists only to be evaluable during
-- `insert … returning`, since it reads company_members/companies and never treks.
drop policy if exists "company members view own treks" on public.treks;
create policy "company members view own treks" on public.treks for select to authenticated
using (public.is_approved_company_member(company_id));


-- ===== B. chat policies — `to public` → `to authenticated` ===================
--
-- The four chat policies that call is_chat_participant() were declared
-- `to public`, which includes anon — but anon does not hold EXECUTE on
-- is_chat_participant (0001 §17.5). An anonymous read of conversation_messages
-- therefore raised `permission denied for function is_chat_participant` rather
-- than returning an empty set. It failed closed and nothing in the app reads
-- chat anonymously, so this is tidiness, not exposure.
--
-- Note this is the OPPOSITE resolution to the load-bearing trio in FEATURES.md
-- Known Gotchas — same shape (a definer function called from a `to public`
-- policy), different answer, because chat genuinely has no anonymous read path
-- while /explore does.
--
-- Only these four are re-scoped. The other four chat policies stay `to public`:
-- "System adds participants" tests `auth.role() = 'service_role'` and would be
-- excluded by re-scoping, and the three `user_id = auth.uid()` ones call no
-- revoked function. Quals are otherwise unchanged — note `is_announcement =
-- false` stays pinned on "Send messages".
drop policy if exists "Users can view their conversations" on public.conversations;
create policy "Users can view their conversations" on public.conversations for select to authenticated
using (public.is_chat_participant(id));

drop policy if exists "Users can view participants of their chats" on public.conversation_participants;
create policy "Users can view participants of their chats" on public.conversation_participants for select to authenticated
using (public.is_chat_participant(conversation_id));

drop policy if exists "Read messages of joined conversations" on public.conversation_messages;
create policy "Read messages of joined conversations" on public.conversation_messages for select to authenticated
using (public.is_chat_participant(conversation_id));

drop policy if exists "Send messages" on public.conversation_messages;
create policy "Send messages" on public.conversation_messages for insert to authenticated
with check (user_id = auth.uid() and public.is_chat_participant(conversation_id) and is_announcement = false);


-- ============================================================================
-- RECORD THIS MIGRATION
-- ============================================================================
insert into supabase_migrations.schema_migrations (version, name)
values ('0002', 'trek-returning-and-chat-policy-roles')
on conflict (version) do nothing;
