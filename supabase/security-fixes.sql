-- Security hardening changelog (rationale + idempotent fix SQL).
-- NOTE: the authoritative current-state DDL/RLS for the whole DB now lives in
-- supabase/schema.sql. This file is kept as the "why" behind each hardening
-- change (referenced by SECURITY_AUDIT_ISSUE.md); apply blocks in order.

-- =====================================================================
-- H1: Stop public reads of PII on profiles.
-- Problem: policy "Public can view profiles" used USING (true) for role
-- public, exposing email / phone_no / emergency_no / emergency_contact /
-- age / Gender to ANYONE (incl. unauthenticated callers with the anon key).
-- Fix: expose only non-PII columns through a view; restrict the base table
-- so a user can read only their OWN row (incl. PII). Cross-user reads
-- (chat participant names, review authors) go through public_profiles.
-- =====================================================================

-- 1) View exposing ONLY non-PII columns. Runs with owner privileges
--    (security_invoker = false, the default), so it can return all rows
--    while exposing nothing sensitive.
create or replace view public.public_profiles as
  select id, full_name, avatar_url
  from public.profiles;

-- 2) Allow the app to read the view. anon is included because logged-out
--    visitors can view public trek pages (review author names/avatars).
grant select on public.public_profiles to anon, authenticated;

-- 3) Remove the over-permissive policy. The existing "Users can view own
--    profile" policy (auth.uid() = id) remains, giving each user full
--    access to their own row only.
drop policy if exists "Public can view profiles" on public.profiles;


-- =====================================================================
-- H2: Lock down trek_batches writes.
-- Problem: INSERT WITH CHECK (true) and UPDATE USING (true) for any
-- authenticated user let anyone tamper with any trek's batch rows.
-- Reality: no client code writes trek_batches; batches are created ONLY
-- by join_trek_and_chat (SECURITY DEFINER, bypasses RLS). treks have no
-- owner column, so there is no legitimate client write path at all.
-- Fix: drop the write policies. Public SELECT stays (dates are visible);
-- the RPC keeps working because SECURITY DEFINER bypasses RLS; all direct
-- client writes are denied by default. (No DELETE policy exists already.)
-- =====================================================================

drop policy if exists "Authenticated users can create batches" on public.trek_batches;
drop policy if exists "Authenticated users can update batches" on public.trek_batches;


-- =====================================================================
-- M1: Scope avatar storage writes to the owning user.
-- Problem: the 'avatars' bucket INSERT/UPDATE/DELETE policies only checked
-- bucket_id = 'avatars', so ANY authenticated user could overwrite or
-- delete ANY other user's avatar object.
-- Fix: mirror the trek-reviews bucket — gate writes on the object path
-- belonging to the caller. Two upload shapes exist in the app, so the
-- ownership check accepts both:
--   * folder-based  avatars/{uid}/{file}      (profile/edit/page.tsx)
--   * root-based    avatars/{uid}.{ext}       (edits/page.tsx)
-- Public SELECT is unchanged (avatars are meant to be world-readable).
-- =====================================================================

-- INSERT: a user may only create objects under their own path.
drop policy if exists "Users can upload avatars" on storage.objects;
create policy "Users can upload avatars"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'avatars' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or name like auth.uid()::text || '.%'
  )
);

-- UPDATE (overwrite): only the owning user, both before and after.
drop policy if exists "Users can update avatars" on storage.objects;
create policy "Users can update avatars"
on storage.objects for update
to authenticated
using (
  bucket_id = 'avatars' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or name like auth.uid()::text || '.%'
  )
)
with check (
  bucket_id = 'avatars' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or name like auth.uid()::text || '.%'
  )
);

-- DELETE: only the owning user.
drop policy if exists "Users can delete avatars" on storage.objects;
create policy "Users can delete avatars"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'avatars' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or name like auth.uid()::text || '.%'
  )
);


-- =====================================================================
-- NEW-1: Pin search_path on is_chat_participant (SECURITY DEFINER).
-- Problem: is_chat_participant gates the ENTIRE chat ACL (every
-- conversations / conversation_participants / conversation_messages
-- policy calls it). It is SECURITY DEFINER but had no SET search_path
-- (proconfig: null). A caller can put an earlier schema on their
-- search_path that shadows conversation_participants (or auth.uid()),
-- making the membership check pass for chats they were never in ->
-- read/write to all conversations. Pinning search_path closes this.
-- Fix is a non-destructive ALTER (function body unchanged).
-- =====================================================================

ALTER FUNCTION public.is_chat_participant(uuid) SET search_path = public, pg_temp;

-- Hygiene: the remaining functions are SECURITY INVOKER (lower risk) but are
-- still flagged function_search_path_mutable by the Supabase linter. Every
-- cross-schema call in their bodies (net.http_post) is already schema-
-- qualified, so pinning search_path is safe and resolves the advisor item.
ALTER FUNCTION public.create_trek_initial_message()  SET search_path = public, pg_temp;
ALTER FUNCTION public.get_trek_participant_count(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.notify_trek_join()             SET search_path = public, pg_temp;
ALTER FUNCTION public.notify_trek_remove()           SET search_path = public, pg_temp;
ALTER FUNCTION public.on_user_join_trek()            SET search_path = public, pg_temp;
ALTER FUNCTION public.update_participants_count()    SET search_path = public, pg_temp;
ALTER FUNCTION public.update_user_stats_timestamp()  SET search_path = public, pg_temp;


-- =====================================================================
-- NEW-2: Create the profiles row server-side on signup (DB trigger).
-- Problem: src/lib/auth.ts inserted the profiles row from the browser
-- right after signUp(). With email confirmation enabled there is no
-- session, so the insert ran as `anon` -> RLS rejected it -> the new
-- user had NO profile row, and the failure was only console.error'd.
-- (It also never set the NOT NULL, unique `email` column, so the insert
-- could not have succeeded even with a valid session.)
-- Fix: a SECURITY DEFINER trigger on auth.users. It runs as the function
-- owner (table owner -> bypasses RLS) and creates the profile from the
-- new auth row at the moment the user is created, before confirmation.
-- The client-side insert is removed from src/lib/auth.ts.
-- =====================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp   -- SECURITY DEFINER must not trust the caller's search_path
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    nullif(trim(new.raw_user_meta_data->>'full_name'), '')
  )
  on conflict (id) do nothing;       -- idempotent: a re-fire must never block auth
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- =====================================================================
-- NEW-3: Require trek-joined to review + drop duplicate policies.
-- Problem: the INSERT policy "Users can review treks they joined" was
-- misnamed — it only checked auth.uid() = user_id and never verified the
-- user joined, so anyone could post reviews / manipulate ratings for treks
-- they never went on. Worse, trek_reviews had TWO permissive INSERT
-- policies (and two identical USING(true) SELECT policies); since
-- permissive policies are OR'd, hardening one while the weak duplicate
-- survives changes nothing. user_stats likewise had two identical
-- auth.uid() = user_id SELECT policies (policy drift).
-- Fix: collapse the duplicates and gate INSERT on a matching
-- trek_participants row (batch -> trek). "Joined" mirrors the app's own
-- check in src/app/trek/[id]/page.tsx: a trek_participants row whose
-- batch_id belongs to a trek_batches row with this trek_id.
-- =====================================================================

-- 1) trek_reviews: collapse the two identical USING(true) SELECT policies
--    into one. Keep "Reviews are viewable by everyone".
drop policy if exists "Users can view reviews" on public.trek_reviews;

-- 2) trek_reviews: replace BOTH weak INSERT policies (each checked only
--    auth.uid() = user_id) with a single policy that also verifies the
--    reviewer actually joined the trek. The weak duplicate must be dropped,
--    not merely supplemented — OR'd permissive policies let it leak.
drop policy if exists "Users can create their own reviews" on public.trek_reviews;
drop policy if exists "Users can review treks they joined" on public.trek_reviews;

create policy "Users can review treks they joined"
on public.trek_reviews
for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.trek_participants tp
    join public.trek_batches tb on tb.id = tp.batch_id
    where tp.user_id = auth.uid()
      and tb.trek_id = trek_reviews.trek_id
  )
);

-- 3) user_stats: drop the duplicate SELECT policy (two identical
--    auth.uid() = user_id reads). Keep the authenticated-scoped
--    "Users can view own stats".
drop policy if exists "Users can view their own stats" on public.user_stats;


-- =====================================================================
-- NEW-4: Stop world-readable trek_participants (social-graph leak).
-- Problem: the SELECT policy "Anyone can view trek participants" used
-- USING (true) for role public. Combined with the public_profiles view
-- (id/full_name/avatar_url, readable by anon), ANYONE incl. logged-out
-- callers with the anon key could enumerate which users joined which trek
-- batch -> a privacy / social-graph leak.
-- Reality: no app feature reads other users' participation rows. Every
-- production query filters by user_id = auth.uid() (own join status,
-- own conversation lookup, own profile trek history) — verified across
-- src/app/trek/[id]/page.tsx, src/app/profile/page.tsx, src/lib/joinTrek.ts.
-- Co-trekker visibility runs through the chat (conversation_participants),
-- not this table; participant counts go through get_trek_participant_count
-- (SECURITY DEFINER, bypasses RLS). So own-row reads are sufficient.
-- Fix: drop the public policy and replace it with an own-rows SELECT
-- scoped to authenticated. This is stricter than the audit's
-- "authenticated only" note (it also blocks cross-user enumeration by
-- logged-in users) and avoids the infinite-recursion trap of a
-- batch-scoped policy that subqueries trek_participants from its own
-- USING clause (Postgres error 42P17).
-- =====================================================================

-- Drop the world-readable policy (live name) and the recursion-prone
-- batch-scoped variant from policies.sql, whichever is present.
drop policy if exists "Anyone can view trek participants" on public.trek_participants;
drop policy if exists "Users can see participants in their batches" on public.trek_participants;

create policy "Users can view own trek participation"
on public.trek_participants
for select
to authenticated
using (user_id = auth.uid());


-- =====================================================================
-- CRIT-1: Remove the hard-coded service_role JWT from the notification
-- triggers (apply via supabase/migrations/20260616000000_*.sql).
-- Problem: the "trek-join-notification" / "trek-leave-notification"
-- triggers on trek_participants used supabase_functions.http_request with
-- a LITERAL Authorization header containing a real, long-lived
-- service_role JWT (role:service_role, exp ~2035). service_role bypasses
-- ALL RLS and storage policies, so possession = full read/write of every
-- table and bucket. It is not pullable anonymously over REST, but it is a
-- plaintext secret at rest, exposed to anything that can read DDL,
-- backups, or logs (and the committed schema.sql masked it, hiding that
-- the live DB held the real key).
-- Key insight: the bearer token never needed to be service_role at all.
-- Both edge functions run verify_jwt=true and read SUPABASE_SERVICE_ROLE_KEY
-- from their OWN env — the header is only used to PASS the gateway, which any
-- valid JWT (incl. the public anon key) satisfies.
-- Fix:
--   1) ROTATE the leaked service_role key in the Supabase dashboard
--      (Project Settings -> API). This is the only step that actually
--      invalidates the exposed key; everything below is the durable
--      replacement. Update any deployment/env using the old key.
--   2) Replace the literal-key triggers with notify_trek_participation(),
--      which reads the token from Vault (vault.decrypted_secrets, secret
--      `edge_function_token`) and rebuilds the standard webhook payload.
--      It is SECURITY DEFINER (to read Vault) and fail-safe (any error is
--      swallowed so a notification failure can't roll back a join/leave).
--   3) Store the token in Vault (recommended: the ANON key, not the
--      service_role key):
--        select vault.create_secret('<NEW_ANON_KEY>', 'edge_function_token',
--          'Bearer token used by trek_participants notification triggers');
-- Until step 3 runs the triggers simply skip sending email (joins/leaves
-- keep working). Full DDL: see the migration file referenced above.
-- =====================================================================


-- =====================================================================
-- M-dos: Harden join_trek_and_chat against batch/chat spam (DoS).
-- Problem: any authenticated user could loop the RPC over unbounded
-- future dates to mass-create trek_batches + conversations (tables they
-- otherwise cannot write). No date validation, no caller enforcement on
-- the NULL p_user_id path.
-- Fix (in schema.sql / migration):
--   * require p_user_id = auth.uid() (reject NULL and mismatches);
--   * validate p_batch_date — not null, not in the past (1-day tz grace),
--     within current_date + 1 year. The unique (trek_id, batch_date)
--     constraint then collapses duplicates, so a user can create at most a
--     bounded number of batches per trek instead of unbounded.
--   * pin search_path = public, pg_temp.
-- Long-term: separate batch creation from joining (admin-created batches;
-- the RPC only attaches to an existing batch). Deferred because the app
-- has no other batch-creation path today.
-- =====================================================================


-- =====================================================================
-- M-update: Drop the trek_participants UPDATE policy.
-- Problem: policy "Users can update own participation" used
-- USING (auth.uid() = user_id) with no WITH CHECK. A user could UPDATE
-- their own row and change batch_id to ANY batch — relocating into a chat
-- they were never added to and satisfying the trek_reviews join-gate
-- (NEW-3) for a trek they never joined. WITH CHECK can't fix it: it can't
-- reference the OLD row, so "batch_id unchanged" is inexpressible.
-- Fix: drop the UPDATE policy. Joining is INSERT, leaving is DELETE; no
-- app code updates this table, so UPDATE is now correctly default-denied.
-- =====================================================================
drop policy if exists "Users can update own participation" on public.trek_participants;
