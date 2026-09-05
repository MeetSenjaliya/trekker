-- Security hardening changelog (rationale + the fix SQL as it was applied).
--
-- ⚠️ CLOSED TO NEW SQL as of 2026-08-13. Everything below is folded into
-- supabase/migrations/0001_baseline.sql; new hardening work is a new migration
-- (see supabase/migrations/README.md). This file remains the "why" behind each
-- change — the reasoning that a migration's DDL cannot carry — and is still
-- referenced by SECURITY_AUDIT_ISSUE.md. Keep appending rationale here when a
-- migration hardens something; do not re-apply the blocks below.
--
-- Current-state DDL/RLS lives in supabase/schema.sql, which is GENERATED from
-- the migrations (npm run db:schema) — not hand-edited, and not this file.

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


-- =====================================================================
-- M-stats: Make user_stats / user_monthly_activity system-managed.
-- Problem: both tables granted the owner INSERT + UPDATE on their own
-- rows (with check auth.uid() = user_id). Since these are aggregate /
-- vanity stats surfaced on the profile page, any authenticated user could
-- self-inflate them from the browser anon client, e.g.
--   update user_stats set treks_completed = 9999, avg_rating = 5
--     where user_id = auth.uid();
-- user_monthly_activity additionally had NO non-negative CHECK on its
-- counters, so values could be set arbitrarily (including negative).
-- No legitimate app code writes these tables (profile/page.tsx only reads
-- them; the only writers were the dev-only src/app/test/* pages).
-- Fix: drop the client INSERT/UPDATE policies on both tables (keep
-- SELECT-own-row). With RLS on and no write policy, clients are
-- default-denied; system maintenance must run through SECURITY DEFINER
-- functions/triggers, which bypass RLS. Add the missing >= 0 CHECKs on
-- the monthly counters.
-- =====================================================================
drop policy if exists "Users can insert their own stats record" on public.user_stats;
drop policy if exists "Users can update their own stats"         on public.user_stats;
drop policy if exists "Users can insert their own monthly record" on public.user_monthly_activity;
drop policy if exists "Users can update their own activity"        on public.user_monthly_activity;

alter table public.user_monthly_activity
  add constraint user_monthly_activity_treks_joined_nonneg    check (treks_joined    >= 0),
  add constraint user_monthly_activity_photos_shared_nonneg   check (photos_shared   >= 0),
  add constraint user_monthly_activity_reviews_written_nonneg check (reviews_written >= 0),
  add constraint user_monthly_activity_distance_km_nonneg     check (distance_km     >= 0);


-- =====================================================================
-- M-stats (part 2): the actual system-managed maintenance path.
-- After part 1 locked the tables (read-only to clients), nothing
-- populated them. This adds the SECURITY DEFINER recompute path so the
-- stats are maintained entirely server-side from source truth.
-- Decisions: avg_rating DROPPED (no meaningful per-user source — treks
-- have no owner, so "rating received" doesn't exist); treks_organised
-- LEFT AT 0 (no organiser column exists yet); treks_completed /
-- total_distance_km accumulate from joined batches whose batch_date has
-- passed (a "completed" trek's distance is added once it is done).
-- recompute_user_stats() is idempotent (rebuilds from source, never
-- blindly adds) so triggers, cron, and re-runs cannot double-count.
-- "Completed" is time-based (no row event when batch_date passes), so a
-- daily pg_cron job recomputes everyone in addition to the DML triggers.
-- Full DDL (function bodies, triggers) lives in schema.sql sections 5/6.
-- =====================================================================
alter table public.user_stats drop column if exists avg_rating;
-- create or replace function public.recompute_user_stats(uuid) ...  (see schema.sql)
-- create or replace function public.trg_recompute_user_stats()  ...  (see schema.sql)
revoke all on function public.recompute_user_stats(uuid) from public, anon, authenticated;
-- triggers: trg_participant_stats (trek_participants), trg_review_stats (trek_reviews)
-- cron: select cron.schedule('recompute-user-stats-daily', '5 0 * * *',
--         $$ select public.recompute_user_stats(p.id) from public.profiles p $$);


-- =====================================================================
-- LEAKED-PASSWORD (2026-06-17): leaked-password protection + Postgres
-- upgrade are both Pro-plan only on this project, so neither is applied
-- on the DB/Auth side.
--   #2 auth_leaked_password_protection: replaced in app code by
--      isPasswordPwned() in src/lib/auth.ts (HaveIBeenPwned range API,
--      k-anonymity; wired into signUp + updatePassword; fails open on
--      HIBP outage). The Auth advisor will still flag this since it only
--      checks the Pro toggle, not app-level enforcement.
--   #3 vulnerable_postgres_version (17.4.1.069): manual upgrade is Pro
--      only; acknowledged on free plan (Supabase patches free-tier infra
--      on their own schedule).
--   #1 security_definer_view (public_profiles): intentional, see
--      DATABASE.md / schema.sql. No change. No SQL to run for any of these.
-- =====================================================================

-- =====================================================================
-- SLUG-IMMUTABILITY (2026-07-03, applied + verified live): pin companies.slug
-- against self-edit. Verified: non-admin UPDATE silently pinned back to OLD
-- (begin/update/rollback as postgres); platform admin still able to change slug.
-- Problem: protect_company_admin_fields() pinned status/approval/created_by
-- but NOT slug. The companies UPDATE policy lets an owner/admin edit their
-- row, so they could PATCH companies set slug=… directly via PostgREST.
-- Because slug is UNIQUE, a freed slug can then be reclaimed by another
-- application → every old /company/[slug] link (shared/indexed/bookmarked)
-- now resolves to a different company (link hijack / impersonation).
-- Fix: pin new.slug := old.slug in the non-platform-admin branch (platform
-- admins can still correct an abusive slug). Reflected in schema.sql §12.5.
-- =====================================================================
create or replace function public.protect_company_admin_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    new.slug              := old.slug;
    new.status            := old.status;
    new.approved_by       := old.approved_by;
    new.approved_at       := old.approved_at;
    new.rejection_reason  := old.rejection_reason;
    new.created_by        := old.created_by;
  end if;
  return new;
end;
$$;

-- =====================================================================
-- EMPTY-BATCH DELETE GUARD (2026-07-04): make the "company deletes empty
-- batches" trek_batches DELETE policy actually verify the batch is empty.
-- Problem: the policy used an inline
--   not exists (select 1 from trek_participants tp where tp.batch_id = ...)
-- subquery. RLS policy subqueries run under the CALLER's own RLS, and
-- trek_participants SELECT is own-row-only — so the check only tested whether
-- the *caller* had joined the batch, not whether anyone had. An owner/admin
-- who never personally booked passes the "empty" test for a batch full of
-- other users' bookings. Today the trek_participants.batch_id FK (NO ACTION)
-- incidentally blocks the delete with a generic FK error, but if that FK is
-- ever changed to CASCADE the guard would silently delete real bookings/chats.
-- Fix: wrap the participant existence check in a SECURITY DEFINER function
-- (batch_has_participants) that bypasses the caller's own-row RLS and sees
-- every participant row, then reference it from the policy. Reflected in
-- schema.sql (helper near is_trek_visible; §12.6 batch policy) and
-- migration-multi-tenant.sql.
-- =====================================================================
create or replace function public.batch_has_participants(p_batch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.trek_participants tp
    where tp.batch_id = p_batch_id
  );
$$;
grant execute on function public.batch_has_participants(uuid) to authenticated;

drop policy if exists "company deletes empty batches" on public.trek_batches;
create policy "company deletes empty batches" on public.trek_batches for delete to authenticated
using (
  exists (select 1 from public.treks t where t.id = trek_batches.trek_id and public.is_company_member(t.company_id))
  and not public.batch_has_participants(trek_batches.id)
);

-- =====================================================================
-- Admin self-lockout on own company_members row
-- Problem: the "manage member roles" (UPDATE) and "remove members" (DELETE)
-- policies only required is_company_admin AND role <> 'owner'. An admin's own
-- row satisfies both, so an admin could self-demote to staff or delete their
-- own membership — losing all management access with no confirmation.
-- Fix: add `and user_id <> auth.uid()` to both USING clauses so an admin can
-- never modify or remove their own row (owner is still protected by role<>'owner').
-- UI: dashboard/team hides the role select + Remove button on the self row.
-- Reflected in schema.sql §12 company_members policies.
-- =====================================================================
drop policy if exists "company admins manage member roles" on public.company_members;
create policy "company admins manage member roles" on public.company_members for update to authenticated
using (public.is_company_admin(company_id) and role <> 'owner' and user_id <> auth.uid())
with check (public.is_company_admin(company_id) and role in ('admin', 'staff'));

drop policy if exists "company admins remove members" on public.company_members;
create policy "company admins remove members" on public.company_members for delete to authenticated
using (public.is_company_admin(company_id) and role <> 'owner' and user_id <> auth.uid());
-- =====================================================================
-- Fix: companies SELECT exposes audit UUID columns to the public
-- ---------------------------------------------------------------------
-- Problem: the "view companies" RLS policy is row-level only, and
-- anon/authenticated hold a table-wide SELECT grant (relacl arwdDxtm).
-- Because PostgREST column selection is client-controlled, any client
-- could `select=created_by,approved_by` on approved companies and cross-
-- reference those UUIDs against the world-readable public_profiles view
-- to deanonymize each company's owner and every approving platform admin.
-- The app-side COMPANY_COLUMNS allowlist gives no protection (it's just
-- the default select, not a server-enforced boundary).
--
-- Fix: replace the table-wide SELECT grant with a column-level SELECT
-- grant covering only the non-sensitive columns. created_by/approved_by/
-- approved_at are removed from every client role's SELECT surface. The
-- admin dashboard, which legitimately needs those columns, reads them via
-- the SECURITY DEFINER RPCs below (gated by is_platform_admin(); the
-- function owner bypasses the column grant). INSERT/UPDATE/DELETE grants
-- are untouched — those paths are governed by RLS + RPCs as before, and
-- the client update path uses return=minimal so it needs no SELECT.
-- =====================================================================

revoke select on public.companies from anon, authenticated;
grant select (
  id, name, slug, description, logo_url, cover_image_url, website,
  contact_email, contact_phone, status, rejection_reason, created_at
) on public.companies to anon, authenticated;

-- admin_list_companies — audit-column company list for the platform-admin
-- dashboard. Replaces the direct table read that selected created_by/
-- approved_by/approved_at (no longer client-selectable). Admin-gated.
create or replace function public.admin_list_companies(p_status text default 'all')
returns setof public.companies
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform admins can list companies';
  end if;
  return query
    select *
    from public.companies c
    where p_status = 'all' or c.status = p_status::public.company_status
    order by c.created_at desc;
end;
$$;
revoke execute on function public.admin_list_companies(text) from public, anon;
grant execute on function public.admin_list_companies(text) to authenticated;

-- admin_get_company — single company with audit columns for the admin
-- detail view. Admin-gated; returns 0 or 1 row.
create or replace function public.admin_get_company(p_company_id uuid)
returns setof public.companies
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform admins can view company audit details';
  end if;
  return query
    select * from public.companies c where c.id = p_company_id;
end;
$$;
revoke execute on function public.admin_get_company(uuid) from public, anon;
grant execute on function public.admin_get_company(uuid) to authenticated;

-- ============================================================================
-- get_trek_batch_confirmed_counts — data-minimization + N+1 fix (2026-07-04)
-- ----------------------------------------------------------------------------
-- Rendering a trek's departure list called get_company_batch_participants once
-- per batch and kept only .filter(status='confirmed').length. That shipped the
-- full contact-PII roster (full_name/phone_no/emergency_contact/emergency_no) of
-- every batch to the browser just to compute an integer, and fired N RPCs for N
-- departures. This RPC returns one count per batch in a single call with no PII.
-- Same membership re-check + empty-set-on-foreign pattern as the roster RPC.
-- Applied + verified live 2026-07-04 (member → correct counts; non-member/anon/unknown trek → empty set).
create or replace function public.get_trek_batch_confirmed_counts(p_trek_id uuid)
returns table (
  batch_id        uuid,
  confirmed_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
begin
  select t.company_id into v_company_id
  from public.treks t
  where t.id = p_trek_id;

  if v_company_id is null or not public.is_company_member(v_company_id) then
    return;
  end if;

  return query
  select tb.id, count(tp.id) filter (where tp.status = 'confirmed')
  from public.trek_batches tb
  left join public.trek_participants tp on tp.batch_id = tb.id
  where tb.trek_id = p_trek_id
  group by tb.id;
end;
$$;
grant execute on function public.get_trek_batch_confirmed_counts(uuid) to authenticated;

-- ============================================================================
-- BATCH DELETE — orphaned-conversation FK guard (2026-07-15)
-- ----------------------------------------------------------------------------
-- deleteBatch() (src/lib/company.ts) failed with an opaque "Error deleting
-- batch: {}" — a PostgREST FK violation (23503) surfaced as a bare object.
-- Cause: join_trek_and_chat creates one conversations row per batch on the
-- first join (conversations.batch_id -> trek_batches.id, FK NO ACTION) and
-- nothing ever deletes it (leaveTrek removes only conversation_participants +
-- trek_participants). So a batch that was joined then fully vacated has ZERO
-- participants — batch_has_participants=false, so the "company deletes empty
-- batches" policy PERMITTED the delete — but still owned a conversations row,
-- and the FK rejected it. This is the exact trap the EMPTY-BATCH DELETE GUARD
-- entry above flagged for the trek_participants FK, reachable here on batches
-- with no participants.
-- Fix (rule: block deletion while any chat exists — no data loss): add a
-- SECURITY DEFINER batch_has_conversation() and require it false in the policy.
-- Definer is mandatory, not an inline subquery: conversations SELECT is
-- is_chat_participant(id) — own-participation-only — so an inline
-- `not exists (... conversations)` runs under the caller's RLS and is blind to
-- a chat the deleting owner never joined, wrongly passing the guard (same
-- reasoning as batch_has_participants). Reflected in schema.sql (helper near
-- batch_has_participants; §12.6 batch policy) and migration-multi-tenant.sql.
-- Now a vacated-but-chatted batch is blocked by RLS (0 rows, no error) and
-- deleteBatch surfaces the friendly "has bookings or chat history" message.
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


-- ============================================================================
-- RATE LIMITING — core write paths (2026-08-05)
-- ----------------------------------------------------------------------------
-- Three uncapped write paths, each with a real cost: chat flood (unbounded
-- inserts into conversation_messages), join/leave email amplification (one
-- cycle fires notify_trek_participation() twice — two emails to real people),
-- and account enumeration via invite_company_member() (it answers whether an
-- email has a Trekker account).
--
-- WHY POSTGRES AND NOT A ROUTE HANDLER: the publishable key ships in the client
-- bundle, so a limit enforced in Next.js is bypassed by calling PostgREST
-- directly. WHY TRIGGERS AND NOT RPC BODIES: these tables carry a direct client
-- INSERT policy alongside their RPC ("Users can join treks"), so a guard placed
-- only in join_trek_and_chat() is skipped by inserting into the table.
--
-- WHY A STATEMENT TRIGGER FOR CHAT: a per-row RLS WITH CHECK cannot see the
-- other rows of its own statement, so PostgREST's array insert would pass 1000
-- messages through a check that reads a count of 0 every time.
--
-- HOW LIMITS ARE COUNTED: from real rows where the evidence survives (chat —
-- messages are soft-deleted, never removed), from the append-only rate_events
-- log where it does not (a left trek deletes its row; a failed lookup writes
-- nothing). rate_events has RLS on with zero policies and grants revoked, so a
-- user can neither read their counter nor delete it to reset a limit.
--
-- CRITICAL — invite_company_member's "no account found" branch had to change
-- from `raise` to `return jsonb`: a raised exception rolls back the rate_events
-- row recording the attempt, so every failed probe erased its own evidence and
-- the limit counted nothing. The distinct not_found answer is KEPT on purpose
-- (it is how an admin learns they typed the address wrong); capped at 20/hour
-- the bulk-enumeration value is gone.
--
-- Verified against live constraints that favorites / trek_reviews /
-- company_members / trek_batches / companies are already bounded by unique
-- indexes and need nothing.
--
-- Applied + verified live 2026-08-05 (rate_events RLS on / 0 policies / no
-- select for anon+authenticated; both triggers present with the right timing;
-- invite_company_member replaced; cron job 'prune-rate-events' jobid 2).
-- Full SQL in supabase/phases/rate-limiting.sql; folded into
-- supabase/schema.sql §13 (+ the §12 invite_company_member body).
-- Storage-upload limits followed as Phase 2, below.
-- ============================================================================


-- ============================================================================
-- RATE LIMITING PHASE 2 — STORAGE UPLOADS (2026-08-05)
-- ============================================================================
-- PROBLEM: every bucket had file_size_limit = null and allowed_mime_types =
-- null, so the only ceiling on an upload was Supabase's global 50MB and any
-- content type was accepted, with no per-user cap on how many. compressImage()
-- runs in the browser and is skipped entirely by calling the Storage API
-- directly with the publishable key. Unbounded ingest = unbounded spend.
--
-- TWO LAYERS, because they stop different things. Layer A alone still allows
-- 10,000 x 3MB; Layer B alone still allows 6 x 50MB.
--   A. Bucket config (3 MiB + jpeg/png/webp on avatars, trek-reviews,
--      company-logos, trek-images) — caps ONE upload, at the storage-api edge,
--      before the bytes are stored. 3 MiB rather than tighter because
--      compressImage() returns the ORIGINAL file when compression fails.
--   B. AFTER INSERT OR UPDATE FOR EACH ROW trigger on storage.objects —
--      6 uploads/hour/user, 20 for trek-reviews.
--
-- INSERT OR UPDATE, not INSERT: avatars write to the fixed path {uid}.{ext}
-- with upsert:true, so after the first upload every avatar write is an UPDATE.
-- An INSERT-only guard would have left the single worst path (no compression,
-- fixed path, unbounded repeat) completely unguarded. storage-api issues a new
-- `version` per real upload, so the version check stops renames and
-- metadata-only touches from consuming budget.
--
-- Counted in rate_events, not from storage.objects: avatars are one row forever
-- and review photos are user-deletable, so the object table is not a truthful
-- counter in exactly the two places that matter.
--
-- A trigger and not four RLS WITH CHECK predicates: a WITH CHECK cannot record
-- an attempt (a side-effecting function in a policy is evaluated an unspecified
-- number of times), the four INSERT policies do not cover the UPDATE path
-- avatars actually uses, and a trigger raises a real message where a failed
-- check gives the client an opaque 42501.
--
-- trek-reviews is carved out at 20/hour because the review form is `multiple`
-- with no file count cap and uploads every photo in one Promise.all — at 6 a
-- single legitimate 8-photo submission would fail partway through its own
-- submit.
--
-- The function lives in public, not storage: `postgres` holds TRIGGER on
-- storage.objects (so the trigger is creatable even though the table is owned
-- by supabase_storage_admin) but NOT CREATE on the storage schema.
--
-- trek-profile deliberately left uncapped: 14 legacy objects, no policies, no
-- client write path — nothing can upload to it.
--
-- Applied + verified live 2026-08-05 (4 buckets at 3145728 + 3 mime types with
-- trek-profile null; trigger tgtype=21 = ROW+INSERT+UPDATE, AFTER, enabled;
-- enforce_storage_rate_limit SECURITY DEFINER owned by postgres with
-- search_path pinned; rate_events still 0 policies and unreadable by
-- anon+authenticated).
-- Full SQL in supabase/phases/rate-limiting-storage.sql; folded into
-- supabase/schema.sql §13.4 + the bucket caps in §9 and §12.7.
-- ============================================================================


-- ============================================================================
-- DRIFT FIX — missing avatars / trek-reviews SELECT policies (2026-08-05)
-- ============================================================================
-- NOT a new rule: schema.sql §9 has documented both of these policies since the
-- storage section was written, but neither existed on the live database. Live
-- pg_policies had SELECT policies for company-logos and trek-images only.
--
-- SYMPTOM: avatar upload failed with a 400 and
--   ERROR: new row violates row-level security policy for table "objects"
-- while the INSERT policy was present and its predicate evaluated true for the
-- exact path being written.
--
-- MECHANISM: supabase-js .upload() makes storage-api run INSERT … RETURNING *,
-- and under RLS a RETURNING clause evaluates SELECT policies against the new
-- row. No SELECT policy for `authenticated` on that bucket => the write is
-- rejected. It hid for a long time because both buckets are public = true, so
-- *displaying* an avatar is served by the CDN without consulting RLS at all —
-- only the write path was broken.
--
-- Found by correlating the storage log (POST 400) with the postgres log (the
-- RLS ERROR) after the rate-limit caps were wrongly suspected. Neither the
-- 3 MiB cap (413) nor the MIME allowlist (415) nor the rate trigger (fires
-- after RLS, and rate_events was empty) could produce that error.
--
-- Applied + verified live 2026-08-05: pg_policies now shows four SELECT
-- policies on storage.objects — avatars, trek-reviews, company-logos,
-- trek-images — each authenticated-only and scoped to its bucket.
-- Full SQL in supabase/phases/fix-missing-avatar-select-policies.sql.
-- schema.sql needed no change: it was already correct; the database was not.
-- ============================================================================


-- ============================================================================
-- FIX — storage rate limit was inert; identity now from new.owner (2026-08-05)
-- ============================================================================
-- The Phase 2 upload cap shipped and did nothing. A real avatar upload
-- committed a 1.84 MB object to storage.objects and public.rate_events gained
-- no row, so the limit stopped nothing while every structural check passed:
-- trigger present, tgenabled='O', tgtype=21, function SECURITY DEFINER owned by
-- postgres with search_path pinned.
--
-- ROOT CAUSE, found by instrumenting the trigger with an unconditional debug
-- write placed ahead of the null guard (supabase/phases/
-- diagnose-storage-rate-limit.sql). One upload produced:
--   tg_op=INSERT  bucket=avatars  uid=NULL  session_replication_role=origin
-- So the trigger fires normally — auth.uid() is simply NULL inside it on the
-- storage-api path. RLS policies on the SAME INSERT do resolve auth.uid()
-- (proved by the earlier "new row violates row-level security policy" error),
-- so the claims GUC is present for policy evaluation but not in the trigger's
-- execution context. Every upload therefore hit the "service-role write" null
-- guard and returned early.
--
-- FIX: v_uid := coalesce(new.owner, auth.uid()). storage-api populates
-- storage.objects.owner from the JWT sub on every upload — verified live:
-- avatars 6/7 rows carry an owner (the 1 null is the seeded image.jpg),
-- trek-reviews 11/11. The client cannot forge it; the Storage API sets it
-- server-side and the storage schema is not exposed through PostgREST. The
-- null guard stays so ownerless service-role and seeded writes are never
-- blocked. auth.uid() is retained as a coalesce fallback.
--
-- Applied + verified live 2026-08-05 END TO END: a real avatar upload produced
-- rate_events(action='upload', actor=662d9204-…) at 12:43:55. rate_debug
-- dropped; function confirmed to contain the coalesce and remain SECURITY
-- DEFINER with search_path pinned.
--
-- PROCESS LESSON: structural verification cannot distinguish a working trigger
-- from an inert one. The first version passed every pg_trigger/pg_proc check
-- and guarded nothing. Any guard on a path the app actually uses must be
-- confirmed by a real write before it is recorded as done — and the two
-- existing rate-limit triggers were not evidence for this one, because they
-- fire on PostgREST writes where the claims GUC IS present.
-- Full SQL in supabase/phases/fix-storage-rate-limit-owner.sql; folded into
-- supabase/schema.sql §13.4.
-- ============================================================================


-- ============================================================================
-- ACCOUNT TYPES — company accounts cannot act as trekkers (applied 2026-08-06)
-- ============================================================================
-- PROBLEM: there was one account model. Every auth user was a full trekker, and
-- "being a company" was purely additive (a company_members row). A company
-- owner could therefore join their own or a competitor's treks, favourite,
-- enter batch chats and post reviews — with no separation between the operator
-- side and the customer side of the platform.
--
-- FIX: profiles.account_type ('trekker' | 'company'), set at signup and pinned
-- against self-edit, with every restriction routed through one predicate:
--
--   is_trekker()  :=  account_type = 'trekker'  OR  is_platform_admin()
--
--   * join_trek_and_chat() raises 'Company accounts cannot join treks'
--   * trek_participants + favorites INSERT policies require is_trekker()
--   * apply_for_company() requires account_type = 'company'
--   * trg_protect_profile_account_type pins the column on UPDATE
--
-- Reviews needed no rule: "Users can review treks they joined" already requires
-- participation. conversation_participants INSERT is service_role-only.
--
-- WHY THE PIN MATTERS: "Users can update own profile" is a plain own-row UPDATE
-- policy. Without the trigger, every rule above is bypassed by one PATCH
-- setting account_type='trekker' — the app would enforce nothing.
--
-- TRIGGER SUBTLETY (caught pre-apply): the first draft copied
-- protect_company_admin_fields' `if not is_platform_admin()` shape. auth.uid()
-- is NULL in the SQL Editor, so that check evaluates FALSE there and the pin
-- would have silently reverted the manual corrections it exists to allow. The
-- shipped version gates on `auth.uid() is not null` first; no client can reach
-- that branch because the profiles UPDATE policy is `to authenticated`.
--
-- VERIFICATION STATUS — structural + data only, at time of writing:
--   PASS  column NOT NULL default 'trekker'; trigger enabled; is_trekker() is
--         SECURITY DEFINER with search_path pinned; execute revoked from anon,
--         granted to authenticated; both policies show is_trekker() in WITH
--         CHECK; all three function bodies contain their guard.
--   PASS  backfill: 2 company / 2 trekker profiles, 0 company_members rows left
--         as trekker.
--   NOT VERIFIED  runtime behaviour. The read-only MCP role cannot execute
--         is_trekker() (permission denied — itself evidence the revoke works)
--         and cannot SET ROLE, so it cannot impersonate a company account. Per
--         the storage rate-limit lesson below, structural checks cannot
--         distinguish a working guard from an inert one. The impersonation
--         block in supabase/phases/phase-f-account-types.sql must be run from
--         the SQL Editor against a NON-ADMIN company account before this is
--         treated as proven.
--
-- KNOWN INTERMEDIATE STATE: apply_for_company() now rejects every existing user,
-- because nothing sets account_type='company' at signup until the AuthPanel
-- toggle ships. Do not deploy to main between these steps.
--
-- Full SQL in supabase/phases/phase-f-account-types.sql; folded into
-- supabase/schema.sql §14.
-- ============================================================================


-- ============================================================================
-- FIX: company_members INSERT policy let an admin add ANY account to their team
--      + invite → accept, so conversion needs consent (applied 2026-08-06)
-- ============================================================================
-- THE BYPASS. The INSERT policy on company_members was
--     with check (public.is_company_admin(company_id) and role = 'staff')
-- It constrained the company and the role but NOT user_id. The publishable key
-- ships in the client bundle, so any owner/admin of any approved company could
-- POST /rest/v1/company_members with an arbitrary user_id and add a stranger to
-- their team, skipping invite_company_member() entirely — a one-liner in a
-- browser console. On its own that is a nuisance: an unwanted membership, which
-- the victim could not see (company_members SELECT is member-scoped) but which
-- also cost them nothing.
--
-- WHY IT BECAME SERIOUS. The account-type split (§14) made account_type
-- immutable, which left a trekker who wants to join a company team with no way
-- across; the chosen design is that accepting an invite converts the account.
-- Layer that on the policy above and the same one-liner silently turns a
-- stranger's trekker account into a company account: no invite, no consent, no
-- undo short of a platform admin. The consent step being built in the same
-- phase would have been decorative while a write path existed that skips it.
--
-- FIX. Drop the policy and revoke the INSERT grant, leaving the two SECURITY
-- DEFINER RPCs as the only way a membership is ever created:
--   apply_for_company()      — the owner row, already definer-only
--   accept_company_invite()  — the invited member, after they consent
-- Verified before dropping that no app code inserts into company_members
-- directly (getMyCompanies and the dashboard layout only read; updateMemberRole
-- and removeMember use the UPDATE/DELETE policies, which are untouched — those
-- are reversible acts on a membership the admin can already see, and they still
-- carry role <> 'owner' and user_id <> auth.uid()).
--
--   drop policy if exists "company admins invite staff" on public.company_members;
--   revoke insert on public.company_members from anon, authenticated;
--
-- THE CONSENT STEP. New company_invites table (company_id, lowercased email,
-- invited_by, role, status pending|accepted|declined|revoked, expires_at +14d;
-- partial unique index on (company_id, lower(email)) where pending).
-- invite_company_member() now writes a pending invite — it keeps its
-- is_company_admin() gate, its 20/hour rate_events cap and its RETURNED (not
-- raised) not_found — and accept_company_invite() does the conversion.
--
-- NO TOKEN, NO EMAIL, on purpose: the invite already required the person to
-- have a Trekker account (it resolves them in profiles by email), so the invite
-- is shown to them at /invites when they sign in. A hashed token + a mail step
-- is what inviting people WITHOUT accounts would need; the deployed edge
-- functions are trek notifications, not transactional mail.
--
-- WHAT accept_company_invite() CHECKS, all derived server-side:
--   * caller authenticated, and has an email on their profile;
--   * the invite is pending, unexpired, and addressed to the caller's OWN
--     profiles.email — so an invite id is not a bearer token;
--   * branches on the RAW account_type, deliberately NOT is_trekker(): that
--     returns true for platform admins whatever their column says, which would
--     send an admin who is already a company account down the conversion
--     branch. An account that is already 'company' just gains the membership,
--     so dropping the INSERT policy does not silently remove the ability to add
--     an existing company account to a second team;
--   * for a trekker, refuses while they hold ANY participation on a batch dated
--     today or later. WAITLISTED counts, not just confirmed — a converted
--     account cannot open /messages, and promote_waitlist_on_leave() promotes
--     FIFO without consulting account_type, so a waitlisted row is a booking
--     that can activate itself after the conversion and strand them in a chat
--     they can no longer reach.
--
-- THE PIN'S ESCAPE HATCH. §14's trg_protect_profile_account_type is extended,
-- not worked around, exactly as that phase said it would have to be. The RPC
-- sets a transaction-local GUC and the trigger honours it:
--     if coalesce(current_setting('app.account_type_change', true), '') = 'allow'
--       then return new; end if;
-- This is safe only because PostgREST gives clients no way to call set_config —
-- it lives in pg_catalog, not the exposed API schema, and the only GUCs a
-- request can influence are the request.* ones PostgREST sets itself. The RPC
-- sets it immediately before its UPDATE and clears it immediately after, and
-- hard-codes 'company' inside the account_type='trekker' branch, so there is no
-- expression anywhere that could move an account the other way. If a future
-- change ever exposes an RPC taking a GUC name, the §14 pin is gone and with it
-- every rule that depends on account_type.
--
-- VERIFICATION STATUS — structural, verified live via read-only MCP 2026-08-06:
--   PASS  company_invites exists, RLS on, exactly ONE policy (SELECT); both
--         partial indexes present with the right predicates.
--   PASS  company_members now has 3 policies (r/w/d) and NO insert policy;
--         has_table_privilege('authenticated','company_members','insert') = f.
--   PASS  company_invites: insert = f and select = t for authenticated;
--         select = f for anon.
--   PASS  all six functions SECURITY DEFINER with search_path pinned; the four
--         new ones are authenticated-only (anon execute = f); the pin trigger is
--         present and its body contains the GUC branch.
--
-- VERIFICATION STATUS — behavioural, run from the SQL Editor 2026-08-06 against
-- a NON-ADMIN company owner and a NON-ADMIN trekker (blocks A–F, all rolled
-- back; both post-checks came back clean and the disabled triggers restored):
--   PASS  A  invite returns an invite_id and creates NO company_members row.
--   PASS  B  direct insert into company_members → 42501 permission denied. Note
--            the code: it is a GRANT denial, not "violates row-level security",
--            so the revoke is what stops it and re-adding a policy alone cannot
--            reopen the path.
--   PASS  C  accept ran to completion — status='accepted' is written by the LAST
--            statement in the RPC, after the account_type flip and the
--            membership insert, so both of those succeeded.
--   PASS  D  a plain `update profiles set account_type='company'` by a trekker
--            is still pinned back to 'trekker'. The GUC hatch did NOT leak — it
--            is reachable only from inside the RPC, as designed. This also
--            behaviourally proves §14's pin, which had been structural-only.
--   PASS  E  a CONFIRMED booking on a batch dated >= today blocks conversion
--            (raised at the upcoming-trek check, i.e. past the invite lookup —
--            so the own-email match works in the accepting direction too).
--   PASS  E2 a WAITLISTED booking blocks it identically. This is the deviation
--            from the original plan ("confirmed" only) and it holds.
--   PASS  F  a third party cannot accept — but weakly: F passed the invite id via
--            a subquery over company_invites, which RLS hides from a non-member,
--            so it may have passed NULL and raised for the right reason by
--            accident. Both outcomes are safe; F2 below settles it.
--   PASS  F2 the STRONG form of the claim. The invite id is captured while
--            impersonating the admin and held in a plpgsql variable across the
--            identity switch, so RLS never gets to filter it and the ownership
--            check in accept_company_invite() is the only thing that can reject.
--            It rejected. Invite ids are not bearer tokens: knowing one is not
--            enough to claim it. (The DO block signals PASS by completing
--            silently — every other path raises, including a deliberate
--            'FAIL — third party accepted a KNOWN invite id' if the accept ever
--            succeeds. "Success. No rows returned" IS the pass.)
--
-- PRE-EXISTING, NOT INTRODUCED HERE: invite_company_member still carries the
-- default PUBLIC execute grant (create or replace preserves the original ACL,
-- and the original never revoked it), so it shows under the anon_… advisor lint
-- while the four new RPCs do not. Inert for anon — auth.uid() is NULL, so
-- is_company_admin() is false and it raises before reading anything — but
--   revoke execute on function public.invite_company_member(uuid, text)
--     from public, anon;
-- would close it, alongside the same optional hardening already tracked for
-- apply_for_company / get_company_members / the is_* helpers.
--
-- Full SQL in supabase/phases/phase-g-invite-accept.sql; folded into
-- supabase/schema.sql §15 (+ §14.3 updated in place for the hatch).
-- ============================================================================


-- ============================================================================
-- FROZEN COMPANIES — rejected / suspended tenants are read-only
-- Applied + verified live 2026-08-08
-- ============================================================================
-- THE HOLE. Company status gated READS and nothing else. is_trek_visible()
-- hid an unapproved company's catalogue, so rejecting or suspending a company
-- looked like it worked from the outside — the treks vanished from Explore. But
-- every company-scoped WRITE policy asked only "is the caller a member?"
-- (is_company_member / is_company_admin, no status test anywhere). A rejected or
-- suspended company therefore kept full write access to its own tenant: invite
-- staff, change roles, remove members, rewrite its public storefront copy,
-- archive/restore treks, add and delete departures. Suspension was a read-side
-- illusion.
--
-- Two of those matter beyond the tenant:
--
--   1. THE INVITE PATH. accept_company_invite() converts a trekker account to a
--      company account, and only a platform admin can convert it back. Invites
--      issued while a company was approved stay live rows after it is rejected,
--      so a stale invite offered a trekker an IRREVERSIBLE account change in
--      exchange for a seat on a tenant that could do nothing at all. Gating the
--      invite RPC alone would not have closed this — the check had to go at
--      ACCEPT time, which is where it now is.
--
--   2. THE PUBLIC BUCKETS. company-logos and trek-images are public. A frozen
--      company could overwrite its logo and cover at the SAME storage paths the
--      storefront already links to, so the CDN served new bytes at the old URL
--      with no companies row ever changing. Table-level gates alone would have
--      left that open.
--
-- Also closed here: /dashboard/treks/new hid the create form behind
-- status = 'approved' and its comment claimed the treks INSERT policy enforced
-- it. It did not — the policy was is_company_member(company_id). The publishable
-- key ships in the client bundle, so a direct POST /rest/v1/treks from a pending
-- or suspended company's admin succeeded. The UI gate had nothing behind it.
--
-- THE FIX. Two tiers, because "not approved yet" and "approval withdrawn" are
-- different situations:
--   is_company_writable()        pending + approved   settings, team, logos
--   is_approved_company_member() approved only        treks, batches, trek images
-- New helper is_company_writable(); is_approved_company_member() already existed
-- (orphaned since the multi-tenant migration) and finally has callers. Bare
-- is_company_member / is_company_admin in a WRITE policy is now a bug — it
-- silently un-freezes a rejected tenant.
--
-- SELECT is deliberately NOT status-gated anywhere: is_trek_visible() already
-- handles read visibility, and staff plus users who already hold bookings must
-- keep reading a hidden trek. Nor are the is_platform_admin() arms — freezing
-- must not lock out the role that un-freezes. Participant flows are untouched:
-- join_trek_and_chat() and the waitlist/count triggers are SECURITY DEFINER, so
-- no existing booking or chat on a suspended company's trek is affected.
--
-- Not gated, deliberately: revoke_company_invite() and decline_company_invite()
-- are de-escalating. Revoking only retires an invite that the accept-time check
-- has already made unacceptable, so blocking it buys nothing.
--
-- NON-DESTRUCTIVE: no data deleted or rewritten, only policies and two function
-- bodies replaced. Re-approving a company restores every capability with no
-- backfill.
--
-- ---- VERIFIED LIVE 2026-08-08 ----------------------------------------------
-- Structural: is_company_writable exists, DEFINER, stable, search_path pinned;
-- EXECUTE granted to authenticated on both helpers; the writable predicate
-- matches status on every companies row; all 14 non-SELECT policies across
-- companies / company_members / treks / trek_batches / storage.objects mention a
-- status-aware helper, at the intended tier (treks + trek_batches + trek-images
-- = approved-only; companies + company_members + company-logos = writable).
--
-- Behavioural — impersonating a real company OWNER who is NOT a platform admin
-- (is_platform_admin() = false, confirmed in the same query, so no false PASS
-- via the admin arm). That user happens to own both an approved and a rejected
-- company, which gives a matched control pair on one identity:
--   PASS  approved  → is_company_admin t, is_company_writable t,
--                     is_approved_company_member t
--   PASS  rejected  → is_company_admin t (membership is NOT what differs),
--                     is_company_writable f, is_approved_company_member f
--   PASS  invite_company_member(rejected_company) → {"error":"company_frozen"},
--         returning before any write.
--   PASS  invite_company_member(approved_company) → reached the rate_events
--         INSERT (blocked only by the read-only connection: "cannot execute
--         INSERT in a read-only transaction", line 25). This is the
--         over-blocking control — it proves the new gate lets an approved
--         company through rather than refusing everyone.
--
-- BEHAVIOURAL VERIFICATION — ✅ RUN AND PASSED 2026-08-08.
-- The above was one step short of a real write attempt. That step is now taken:
-- supabase/phases/verify-phase-h.sql, run block by block from a write-capable
-- SQL Editor session, every block rolled back, all results as expected —
--   PASS  approved control: is_company_writable t, companies UPDATE 1, treks
--         INSERT 1. Without this the refusals below prove nothing.
--   PASS  rejected: companies UPDATE 0, treks UPDATE 0 (silent — a row failing
--         USING simply does not match), trek_batches INSERT raised 42501
--         (INSERT fails WITH CHECK, so it errors where UPDATE does not).
--   PASS  suspended behaves identically to rejected.
--   PASS  accept_company_invite() on a frozen company raised "That company is no
--         longer active on Trekker"; the same invite with no freeze accepted
--         cleanly (account_type → company, membership row created).
--   PASS  platform admin still wrote to a suspended tenant's trek and company row
--         (UPDATE 1 each) and unfroze it with approve_company().
--   PASS  storage: company-logos + trek-images accepted the owner's write while
--         approved, refused it while frozen. The half table gates would miss —
--         both buckets are public, so an overwrite at the same CDN path changes
--         what visitors see without any companies row changing.
--   PASS  post-check: nothing leaked past a ROLLBACK.
--
-- ⚠️ The VERIFY template inside phase-h-frozen-companies.sql could NOT have been
-- run as written, and still reads plausibly — see the header of verify-phase-h.sql.
-- Its freeze step is inert (trg_protect_company_admin_fields reverts a direct
-- status UPDATE whenever is_platform_admin() is false, which it always is in the
-- SQL Editor, where auth.uid() is null) and its <trek_id> was unresolvable.
--
-- Full SQL + verification blocks: supabase/phases/phase-h-frozen-companies.sql
-- Behavioural run: supabase/phases/verify-phase-h.sql
-- Folded into supabase/schema.sql §16 (DDL in place at §12.4/12.6/12.7, 15.3, 15.5).
-- ============================================================================


-- ============================================================================
-- STORAGE RATE LIMIT — the guard worked, the user was told the wrong thing
-- (2026-08-08, applied + verified live)
-- ============================================================================
-- Not a hole; a hardening step that was unusable in practice. The 6/hour upload
-- cap (§13.4) rejected the 7th upload correctly — 6 rate_events rows, the raise
-- verbatim in the Postgres log, POST /object/avatars/... -> 500 in the storage
-- log — but the user saw "The image failed to upload. Please try again."
--
-- storage-api does not forward a database error message to the client. It
-- answers 500 with a body of `{}`, so supabase-js builds its StorageApiError
-- message from JSON.stringify(body) — literally "{}". The client-side mapping
-- in src/lib/uploadErrors.ts matched on the raise text, which never arrives.
--
-- No errcode fixes this: storage-api maps 42501 to its own hardcoded RLS text
-- and 23505/23503 to key/bucket errors, everything else to an opaque 500.
--
-- WHY THIS IS A SECURITY-ADJACENT ENTRY AND NOT A UX ONE: a rate limit the user
-- cannot distinguish from a transient failure trains them to retry, which is
-- the exact behaviour the cap exists to suppress, and it hides from the
-- operator that the cap is being hit at all.
--
-- FIX — public.upload_rate_limited(p_bucket text), a read-only SECURITY DEFINER
-- probe the client calls ONLY after an upload has already failed with an
-- unrecognised error. It consumes no budget, so probing after a rejection
-- cannot push the caller further into the limit.
--
-- DISCLOSURE BOUNDARY: it returns one boolean about the caller's own counter.
-- rate_events keeps RLS on with zero policies and revoked grants, so no count,
-- timestamp or other actor is reachable. EXECUTE granted to authenticated only;
-- anon is revoked (and would get `false` anyway — auth.uid() is null).
-- The bucket -> (action, limit) mapping moved into storage_rate_rule() so the
-- enforcer and the probe cannot drift apart; that helper is revoked from every
-- client role since both callers are DEFINER and owned by postgres.
--
-- VERIFIED LIVE 2026-08-08: upload_rate_limited prosecdef = t, provolatile = s,
-- anon execute = f, authenticated execute = t; storage_rate_rule execute denied
-- to anon + authenticated; end-to-end, a rate-limited avatar upload now shows
-- "You have uploaded too many images in the last hour. Please try again later."
--
-- Full SQL + verification blocks: supabase/phases/fix-storage-rate-limit-message.sql
-- Folded into supabase/schema.sql §13.4 (storage_rate_rule) + §13.5 (probe).
-- ============================================================================


-- ============================================================================
-- FORGED OPERATOR ANNOUNCEMENTS — a new column the write policies didn't know
-- about (2026-08-08 applied; behaviourally verified 2026-08-12)
-- ============================================================================
-- Batch announcements (schema.sql §17) add
-- conversation_messages.is_announcement, which the trekker UI renders as an
-- amber operator notice with a Megaphone badge — a trust signal in a chat full
-- of strangers.
--
-- PROBLEM: the INSERT policy was `user_id = auth.uid() AND
-- is_chat_participant(conversation_id)` and said nothing about the new column.
-- The publishable key ships in the client bundle, so any trekker already in a
-- batch chat could
--   POST /rest/v1/conversation_messages {is_announcement: true, …}
-- and render a message their fellow bookers would read as coming from the
-- operator — "meeting point moved", "bring cash". The UPDATE policy left the
-- same forgery reachable by editing an ordinary message afterwards. Adding a
-- column to a table whose policies enumerate columns is a silent widening: the
-- policy keeps passing, it just no longer covers everything it should.
--
-- FIX — `and is_announcement = false` in the with_check of BOTH "Send messages"
-- and "Edit own messages". post_batch_announcement() is unaffected: it is
-- SECURITY DEFINER owned by postgres, which owns the table and has NOT set
-- FORCE ROW LEVEL SECURITY, so it bypasses both policies. The pin therefore
-- binds PostgREST clients only, and the RPC is the sole writer able to set the
-- flag.
--
-- ACCEPTED SIDE EFFECT: an announcement is immutable through the table API,
-- soft-delete included. The author is not a chat participant, so the messages
-- page never offers them edit/delete anyway; a wrong announcement is corrected
-- by posting again.
--
-- VERIFIED LIVE 2026-08-12, as a real write through PostgREST rather than
-- structurally. Signed in as a non-admin trekker who IS a participant of the
-- target conversation:
--   is_announcement:true          -> 403 / 42501 new row violates RLS policy
--   same insert, flag omitted     -> 201, row returned with is_announcement=false
-- The pair is the evidence. A refusal on its own is equally consistent with a
-- missing grant, a bad conversation id or an unrelated policy; only the control
-- half pins the refusal to this conjunct.
--
-- ⚠️ SETUP TRAP, same family as the phase-H one: the SQL Editor connects as
-- `postgres`, which owns the table and is not FORCE'd, so BOTH halves succeed
-- there unless the block does `set local role authenticated` — a working guard
-- reads as broken-open. The run above avoided it entirely by going through the
-- client's own key and access token.
--
-- Full SQL + verification blocks: supabase/phases/phase-i-batch-announcements.sql
-- Folded into supabase/schema.sql §17 (DDL in place at §2 column + §8 policies).
-- ============================================================================


-- ============================================================================
-- ANNOUNCEMENTS TO AN EMPTY ROOM — "a conversation exists" is not "someone is
-- listening" (2026-08-12, applied + verified live)
-- ============================================================================
-- Not a hole; a guard that reported success for a message with no readers.
-- post_batch_announcement() refused only when the batch had NO conversations
-- row. But join_trek_and_chat() creates that row on the first confirmed booking
-- and leaveTrek() clears only conversation_participants — the conversation
-- outlives every member, which is the same fact behind "a departure can't be
-- deleted once anyone has ever joined". So a departure everyone had left still
-- accepted an announcement, wrote it into a chat with zero participants, and
-- returned {id, conversation_id, created_at} to the operator. 10 of 17 batches
-- were in that state when this was found.
--
-- FIX — a second refusal branch: `not exists (select 1 from
-- conversation_participants where conversation_id = v_convo_id)`. Kept separate
-- from the no-conversation branch, with its own message, because they are
-- different facts about the departure and postBatchAnnouncement() surfaces
-- P0001 text verbatim — "No one has booked this departure yet" is untrue of a
-- departure five people booked and then left.
--
-- NO CLIENT-SIDE GATE, still deliberate: the participants page roster includes
-- waitlisted trekkers, who get no conversation_participants row, so a
-- `participants.length` check would refuse a departure that can be announced to
-- and allow one that cannot. The RPC owns the rule.
--
-- VERIFIED LIVE 2026-08-12: the new branch and the original both present in the
-- live definition, prosecdef = t, search_path pinned, anon execute = f,
-- authenticated execute = t (CREATE OR REPLACE preserved the ACL, so the
-- revoke/grant pair from §17 carried over), and the anon-executable definer
-- count stayed at the load-bearing 3.
--
-- Full SQL + verification blocks:
--   supabase/phases/fix-announcement-requires-listeners.sql
-- Folded into supabase/schema.sql §17.
-- ============================================================================


-- ============================================================================
-- EXECUTE GRANTS THAT LIVED ONLY IN THE DATABASE — found by the new db suite
-- ============================================================================
-- Not a live hole. A documentation hole with a security-shaped blast radius:
-- production was correct and supabase/schema.sql was not, so replaying the file
-- onto a fresh project produced a MEASURABLY LESS SAFE database than the real
-- one. Recorded here because that failure mode is invisible to advisors — they
-- lint the live database, which was fine.
--
-- FOUND 2026-08-13 by tests/db/acl.test.ts, on its first run.
--
-- 18 SECURITY DEFINER functions were revoked from anon by
-- phases/fix-anon-execute-definer-rpcs.sql, applied live 2026-08-08 and never
-- folded back into schema.sql. Among them get_company_batch_participants(),
-- which returns phone_no / emergency_contact / emergency_no for every booking
-- in a batch. A further 2 — is_chat_participant() and join_trek_and_chat() —
-- had anon = false live with NO grant or revoke in ANY file under supabase/;
-- that state existed only in the database and nothing could reproduce it.
--
-- WHY IT PERSISTED: Postgres grants EXECUTE to PUBLIC on every new function,
-- and `create or replace` preserves the existing ACL. So a definer RPC created
-- without an explicit revoke stays anon-callable forever, and nothing in the
-- policy text hints at it. Reading the policies cannot find this class of bug —
-- only reading the ACLs can, which is why acl.test.ts is a separate file.
--
-- All 20 verified against production with has_function_privilege() before being
-- written down. schema.sql §17 now records live state; applying it is a no-op.
--
-- REGRESSION GUARD: acl.test.ts asserts that the set of anon-executable definer
-- functions is EXACTLY {is_trek_visible, is_company_member, is_platform_admin}
-- — and, in the other direction, that those three keep the grant. Both halves
-- matter: the trio is called from `to public` SELECT policies on treks /
-- trek_batches / companies, so revoking them to get the advisor to zero takes
-- /explore, /trek/[id] and /company/[slug] down for anonymous visitors.
--
-- Full SQL: supabase/schema.sql §17.


-- ============================================================================
-- createTrek() BROKEN BY ITS OWN SELECT POLICY + CHAT POLICY ROLE SCOPING
-- ============================================================================
-- FOUND 2026-08-13 by tests/db/catalogue-writes.test.ts and chat.test.ts.
--
-- (A) NOT a hole — an availability bug, logged here because the fix sits one
-- keystroke away from a real one. `insert … returning` applies the table's
-- SELECT policy to the returned row. "view treks" is is_trek_visible(id), which
-- is `stable` and selects from public.treks, so it runs against the statement's
-- pre-insert snapshot, cannot see the row being created, and returns false. The
-- insert is rejected with `new row violates row-level security policy` — an
-- error that reads like a with_check failure and points at the wrong policy.
-- src/lib/company.ts does .insert({...}).select('id').single(), so NO company
-- could publish a trek; platform admins failed too, since the
-- `or is_platform_admin()` arm sits inside the same unsatisfiable FROM.
--
-- ⚠️ THE OBVIOUS FIX IS AN OUTAGE. Folding the arm into "view treks" as
--      using (is_trek_visible(id) or is_approved_company_member(company_id))
-- breaks the public site: that policy is `to public`, which includes anon, and
-- is_approved_company_member is revoked from anon (§17.3). Every anonymous
-- /explore and /trek/[id] read would raise permission denied for function.
--
-- FIX — a SECOND permissive policy scoped `to authenticated`. Postgres applies
-- only policies whose roles include the current role, so anon never evaluates
-- it, and permissive policies on one command are OR'd. Its predicate reads
-- company_members/companies and never treks, so no snapshot dependency. Grants
-- nothing new: is_trek_visible already carries `or is_company_member(company_id)`
-- ungated by status, and this is the strictly narrower approved-only form.
--
-- (B) The four chat policies calling is_chat_participant() were `to public`
-- while anon lacks EXECUTE on it, so anonymous reads raised permission denied
-- rather than returning empty. Failed closed; re-scoped `to authenticated` for
-- tidiness. The other four chat policies stay `to public` deliberately —
-- "System adds participants" admits service_role and would be excluded by
-- re-scoping, and the three user_id = auth.uid() ones call no revoked function.
--
-- THE GENERAL RULE, which (A) and (B) resolve in OPPOSITE directions: a policy's
-- role list and its predicate's EXECUTE grant must agree. Chat has no anonymous
-- read path, so the policy narrows to match the grant. /explore does, so the
-- grant stays wide to match the policy. Check both halves when adding either.
--
-- VERIFIED LIVE 2026-08-13 after apply: treks carries two SELECT policies,
-- "view treks" {public} and "company members view own treks" {authenticated};
-- the four chat policies are {authenticated} with quals intact (is_announcement
-- = false still pinned on "Send messages"); the four left alone are unchanged;
-- and is_trek_visible still holds its anon EXECUTE grant.
--
-- Full SQL + verification block:
--   supabase/phases/fix-trek-returning-and-chat-policy-roles.sql
-- Folded into supabase/schema.sql §12.6 (treks) and §8 (chat).
-- ============================================================================


-- ============================================================================
-- 0003 — lock platform_admins grants (defense in depth)   ·   2026-08-18
-- ============================================================================
-- WHY: platform_admins (the super-admin allowlist) was protected only by RLS
-- enabled with ZERO policies. In production the table still carried Supabase's
-- default GRANT ALL to anon/authenticated, so a plain `select` returned `[]`
-- with 200 (not a permission error), and — more importantly — RLS was the SOLE
-- barrier. Disable RLS once (a stray migration, a debug session) and an
-- anonymous caller could read the admin list AND insert its own uid as an admin:
-- full privilege escalation. A Strix Day-1 probe (TEST.md) surfaced the [] read.
--
-- There is no client path to add an admin (no policy, no RPC — rows are inserted
-- only in the SQL Editor as the table owner), and exactly one admin exists today
-- (senjaliyameet8@gmail.com). This closes the last-resort hole, not an active one.
--
-- FIX: revoke all on public.platform_admins from anon, authenticated — the same
-- treatment rate_events already had. The table is now defended by BOTH the
-- missing privilege AND RLS; either alone denies access, and a client read
-- returns a hard permission error instead of an empty-array oracle.
--
-- Full SQL: supabase/migrations/0003_lock-platform-admins-grants.sql
-- Test: tests/db/acl.test.ts "platform_admins is unreachable by clients" now
-- asserts the grant is gone (has_table_privilege false), not just RLS behaviour.
-- STATUS: APPLIED + VERIFIED LIVE 2026-08-18 10:08 UTC. platform_admins.relacl
-- is now {postgres, service_role} only; has_table_privilege is false for
-- anon/authenticated on SELECT and INSERT; RLS still on with zero policies;
-- ledger records 0003. Folded into schema.sql; tests/db/acl.test.ts asserts it.
-- ============================================================================


-- ============================================================================
-- CRIT-1 follow-up: remove the last embedded key from the notification trigger
-- (0008_drop-embedded-publishable-key-from-notification-trigger.sql)
-- ============================================================================
-- WHY: CRIT-1 (above) pulled the service_role JWT out of the notification
-- triggers and moved authorization to a Vault secret, but left ONE literal in
-- notify_trek_participation()'s body: the project's publishable key, sent on
-- `apikey`, with an inline comment asking whoever rotates the key to come back
-- and edit the DDL.
--
-- This is NOT a disclosure. The publishable key is public by design — it ships
-- in every browser bundle, and CRIT-1's own note recommended exactly this
-- substitution. It is a ROTATION TRAP: nothing enforces the comment, so the day
-- the key is rotated the literal becomes a *wrong* key. The gateway rejects a
-- wrong key with 401 {"message":"Invalid API key"} BEFORE the function runs,
-- and the trigger's `exception when others` swallows it — joins and leaves keep
-- working and the emails silently stop. A stale key is strictly worse than no
-- key.
--
-- KEY INSIGHT (measured, not assumed — live project, 2026-08-26): the header was
-- never needed. Both functions run verify_jwt=false, and the Supabase gateway
-- only validates an `apikey` when one is PRESENT:
--   no apikey      -> request reaches the function (x-served-by:
--                     supabase-edge-runtime, x-deno-execution-id present); its
--                     own x-trek-webhook-secret check returns the 401
--   valid apikey   -> identical
--   invalid apikey -> gateway 401 "Invalid API key", no execution-id, function
--                     never runs
-- CRIT-1's "the header is only used to PASS the gateway" was true of the
-- verify_jwt=true configuration it was written against; both functions are
-- verify_jwt=false today.
--
-- FIX: drop the `apikey` header and the `v_apikey` declaration entirely. No key
-- material of any kind remains in DDL, and there is nothing left to keep in
-- sync on rotation. Authorization is unchanged — the Vault secret
-- (`edge_function_token`) on `x-trek-webhook-secret`, which both functions
-- compare in constant time (EDGE-004). Everything else is carried over
-- verbatim: SECURITY DEFINER, pinned search_path, the skip-when-no-secret
-- branch, and the exception handler.
--
-- Moving the key to Vault was the obvious alternative and is the worse one: it
-- keeps a rotation step that nothing enforces, for a header that buys nothing.
--
-- Test: tests/db/no-embedded-credentials.test.ts — no function body in `public`
-- may contain an `sb_publishable_…`/`sb_secret_…` or JWT-shaped literal, and
-- notify_trek_participation() must still send x-trek-webhook-secret and no
-- apikey. The comment was the control before; now the suite is.
-- STATUS: APPLIED + VERIFIED LIVE 2026-08-26 10:04:57 UTC. Ledger records 0008
-- (0001-0008, no gaps). Verified in pg_proc, not just the ledger:
-- notify_trek_participation() is prosecdef with search_path=public,pg_temp,
-- still reads edge_function_token and sends x-trek-webhook-secret, still has its
-- exception handler, and matches neither the key-literal pattern nor 'apikey'.
-- Widened to the schema: 0 functions in public hold a key or JWT literal. Both
-- notification triggers on trek_participants present and enabled.
-- NOT verified: that an email actually sent. net._http_response has no rows for
-- 2026-08-26 (no join/leave since), and structural checks cannot tell a working
-- trigger from an inert one -- the storage rate-limit trigger passed every
-- structural check while recording nothing. Next real join should leave a 2xx in
-- net._http_response.
-- ============================================================================

-- ============================================================================
-- 0009 — input caps moved from the form into the database (2026-09-02)
-- ============================================================================
-- FINDING (2026-08 Day 7 pass, `strix-prompts/day 7 results.md`; `TEST.md`
-- §7.2.1 for the message case): six columns were bounded only by Zod in
-- `src/lib/schemas.ts`. The app reaches PostgREST with the publishable key, so
-- every one of those bounds was advisory — curl, the browser console or any
-- REST client wrote past them. The sharpest was `conversation_messages.message`:
-- unbounded, it is a storage and render-cost amplifier aimed at every other
-- member of a batch chat. `post_batch_announcement()` restated the 2000-char cap
-- but only for announcements, so a direct insert had never had a server-side
-- bound at all.
--
-- FIX: six CHECK constraints — message <= 2000, full_name <= 100, bio <= 500,
-- estimated_cost >= 0, and max_participants > 0 on both `treks` and
-- `trek_batches`. NULL is untouched everywhere (a CHECK passes on NULL), so
-- "unset name" and "uncapped departure" keep working.
--
-- Zero capacity is rejected rather than only negatives: a departure with no
-- seats is not a state the product means anything by, and NULL already carries
-- "no limit". That made two client changes non-optional rather than cosmetic —
-- `optionalInt` moved to a `>= 1` floor so the capacity forms answer inline
-- instead of surfacing a raw constraint violation, and `signUpSchema.fullName`
-- gained the `.max(100)` it never had. Without the second, a long signup name
-- would have failed *inside* `handle_new_user()`, after `auth.users` already
-- held the row.
--
-- Upper bounds only on the text columns. A `length(message) >= 1` would mirror
-- `messageSchema` and would break deletion: the client soft-deletes by setting
-- `is_deleted = true, message = ''`
-- (`src/app/(trekker)/messages/page.tsx:444`), so the empty string is
-- load-bearing, not a gap.
--
-- `drop constraint if exists` precedes each `add constraint` — Postgres has no
-- `add constraint if not exists`, and the file has to survive a second run in
-- the SQL Editor. Idempotence elsewhere in the lineage comes free from
-- `create or replace` / `if not exists`; this is the first migration that had to
-- ask for it.
--
-- No backfill and no NOT VALID staging: checked over the read-only MCP on
-- 2026-09-02 immediately before writing, 0 rows violate any of the six, widest
-- values 811 / 18 / 6 chars against caps of 2000 / 100 / 500.
--
-- Test: tests/db/input-constraints.test.ts — every bound asserted on both sides
-- (2000 accepted, 2001 rejected; capacity 1 accepted, 0 and -5 rejected), plus
-- NULL and the soft-delete empty string still accepted. All of it runs through
-- asSuperuser so RLS is out of the picture: under asUser a policy denial and a
-- constraint violation both raise, and a test that cannot tell them apart would
-- stay green if the constraint were dropped.
-- STATUS: APPLIED + VERIFIED LIVE 2026-09-02. Ledger records 0009 (0001-0009,
-- no gaps). Verified in pg_constraint, not just the ledger: all six constraints
-- present with convalidated = true and the expected definitions.
-- FOLLOW-ON: 0010 closes the floor this left open on `message` -- the ceiling
-- alone still admitted '' and '   ' from a direct insert -- and clamps
-- handle_new_user(), which profiles_full_name_len turned into a failure path.
-- ============================================================================

-- ============================================================================
-- 0010 — blank-message bypass closed, signup name clamped (2026-09-02)
-- ============================================================================
-- FINDING (self-review of 0009 against the live database, not a pentest pass):
-- two follow-ons.
--
-- 1. `0009` gave `conversation_messages.message` a ceiling and no floor, so a
--    direct PostgREST insert could still write '' or '   '. messageSchema
--    requires >= 1 char after trimming. Same skip-the-form bypass 0009 set out
--    to close, left open on the other side.
--
--    The floor cannot be unconditional -- soft-delete is an UPDATE setting
--    `is_deleted = true, message = ''`, so blank is a legal row shape for
--    exactly one case. That is why 0009 shipped no floor rather than a wrong
--    one; the conditional form is what it was missing.
--
--    The constraint alone would be close to decorative. Nothing pinned
--    `is_deleted` on INSERT -- the "Send messages" policy checked user_id, chat
--    participation and `is_announcement = false` only -- so a client could
--    insert a blank row with is_deleted = true and satisfy the CHECK on the way
--    past. Both halves are needed; either alone is a half-measure.
--
-- 2. `handle_new_user()` copies raw_user_meta_data->>'full_name' unbounded.
--    Before 0009 a long name was stored; since 0009 it hits
--    profiles_full_name_len and raises. Stated precisely, because an earlier
--    note on this was wrong: the trigger is AFTER INSERT with no exception
--    handler, in the same transaction as the auth.users insert, so a violation
--    aborts everything and the auth.users row rolls back too. There is no
--    half-created account -- the signup fails cleanly with an opaque 500.
--    Reachable today only via the GoTrue API directly (the form is capped);
--    reachable by ordinary users the day a social provider is added, since
--    provider display names are unbounded and not ours to validate. `email` is
--    the only provider on the project right now (5 identities, longest metadata
--    name 15 chars), so this is pre-emptive.
--
-- FIX: `check (coalesce(is_deleted, false) or length(btrim(message)) > 0)`;
-- "Send messages" replaced to add `coalesce(is_deleted, false) = false`
-- (coalesce, not a bare `= false`, because the column is nullable and an
-- explicit null would otherwise make the comparison null and reject a write);
-- and `left(nullif(trim(...), ''), 100)` in handle_new_user(). Clamping beats
-- raising for a cosmetic field -- a too-long name is not a reason to refuse
-- someone an account, and a 500 from inside a trigger is the least debuggable
-- way to say so.
--
-- "Edit own messages" (UPDATE) is deliberately untouched: it is the delete
-- path, and pinning is_deleted there would make deletion impossible. Blanking
-- without deleting is already refused by the new CHECK.
--
-- Test: tests/db/input-constraints.test.ts (blank and whitespace-only rejected,
-- the soft-delete shape accepted, the 150-char name truncated to 100 rather
-- than raising, a blank name still stored as null) and tests/db/chat.test.ts
-- ('refuses a message that arrives already soft-deleted' for the policy pin,
-- 'still lets a member soft-delete their own message' for the path it must not
-- break).
-- STATUS: APPLIED + VERIFIED LIVE 2026-09-02. Ledger records 0010 (0001-0011,
-- no gaps). Verified beyond the ledger: conversation_messages_message_not_blank
-- present and convalidated; the "Send messages" with_check now carries
-- `COALESCE(is_deleted, false) = false` alongside the is_announcement pin; and
-- handle_new_user()'s body contains the left() clamp.
-- NOT verified: that a real signup carrying a 150-char provider name truncates
-- rather than 500s. Structural checks cannot prove a trigger path end-to-end --
-- the storage rate-limit trigger passed every structural check while recording
-- nothing. The PGlite test does exercise it against auth.users directly.

-- ============================================================================
-- 0011 — the remaining Zod-only text caps (2026-09-02)
-- ============================================================================
-- FINDING: the tail of 0009. Eight more columns whose only bound lived in
-- src/lib/schemas.ts: treks.title (150), description (2000), location (200),
-- meeting_point / meeting_point2 (300), gear_checklist (2000),
-- profiles.emergency_contact (100), emergency_no (20).
--
-- No abuse story attached to any of them, which is why they were not in the Day
-- 7 list: unlike conversation_messages.message, nothing here fans out to other
-- users' render cost. They are storage-side sloppiness rather than a lever. The
-- reason to close them is that a rule enforced in one place is a rule that
-- quietly stops being true in the other.
--
-- FIX: eight CHECKs, each the existing Zod value rather than a new judgement.
-- gear_checklist is text[] and its Zod cap is on the raw textarea before the
-- split, so the CHECK bounds `array_to_string(gear_checklist, E'\n')` -- the
-- same 2000 chars on the same string. A per-element or array-length cap would
-- be a different rule wearing the same number.
--
-- Deliberately not capped: profiles.phone_no (no Zod counterpart -- the schema
-- carries the emergency contact's phone, not the user's own; capping it would
-- be inventing a limit), treks.plan and treks.rating (not on the form).
--
-- Noticed while mapping these and NOT fixed here, being a client bug rather
-- than a schema one: emergencyContactRelationship is collected and validated at
-- 60 chars and then written to no column at all --
-- src/app/(trekker)/profile/edit/page.tsx:176-177 persists name and phone and
-- drops it. There is no column to constrain.
--
-- Existing data checked over the read-only MCP 2026-09-02: 0 rows exceed any
-- bound. Widest were title 27/150, description 93/2000, location 23/200, both
-- meeting points 89/300, gear_checklist 46/2000 over at most 3 items,
-- emergency_contact 7/100, emergency_no 10/20.
--
-- Test: tests/db/input-constraints.test.ts -- each cap on both sides, plus the
-- gear_checklist case built to be over by exactly the newline separator, which
-- a per-element rule would pass.
-- STATUS: APPLIED + VERIFIED LIVE 2026-09-02. Ledger records 0011 (0001-0011,
-- no gaps). All eight constraints present in pg_constraint with convalidated =
-- true. Note profiles_emergency_no_len reads as
-- `length((emergency_no)::text) <= 20` -- emergency_no is varchar with no
-- declared length, so Postgres inserts the cast; semantically identical.
-- ============================================================================

-- ============================================================================
-- 0012 — the notification-email cap moved from the edge functions into Postgres
--        (2026-09-02)
-- ============================================================================
-- FINDING (open follow-up, not a new pentest hit): EDGE-003 capped outbound
-- trek notification mail at 10/hour per recipient, but the cap lived entirely
-- in `send-trek-notification` / `send-trek-leave-notification`. Both hold the
-- SECRET key, which bypasses RLS on `rate_events`, so the count was a policy
-- the caller applied to itself -- the same shape the rate-limiting phase
-- rejected for Route Handlers in 2026-08-05. Anything else holding that key (a
-- future revision of either function, the leaked secret the cap exists for)
-- could mail without counting. Check-then-insert was also non-atomic: ten
-- concurrent webhook calls each read a count of 9 and each sent, so the real
-- cap was "10 + concurrency".
--
-- FIX: `enforce_trek_email_rate_limit()`, a BEFORE INSERT row trigger on
-- `rate_events` scoped `WHEN (new.action = 'trek_email')`. The insert becomes
-- the gate, so a send cannot be recorded without being counted, and a
-- `pg_advisory_xact_lock` keyed on the recipient serialises the
-- read-modify-write that concurrency was racing.
--
-- On `rate_events` rather than a new table: it already IS the dedicated
-- rate-limit log (0001 §13.1 -- zero policies, zero client grants, pruned
-- hourly by pg_cron), and both functions already share the one 'trek_email'
-- action so alternating endpoints cannot double the rate. A second table would
-- need its own index, RLS and prune job and would split that counter in two.
-- The WHEN clause keeps 'join'/'invite'/upload counting untouched -- their caps
-- live in triggers on the tables being written, and a cap here would count them
-- a second time.
--
-- BEFORE, not AFTER: the count must not include the row being inserted, or the
-- effective cap would be nine. EXECUTE revoked from public/anon per §17.4 of
-- 0001 -- Postgres checks EXECUTE at CREATE TRIGGER time, not at fire time, so
-- the default PUBLIC grant would only have put a new DEFINER function on anon's
-- list.
--
-- Both edge functions changed in the same commit: they now insert first and
-- treat P0001 as their 429. The deployed versions insert AFTER deciding to
-- send, which under this trigger would let the 10th email through and raise on
-- the 11th attempt -- so they must be redeployed with the migration.
--
-- Test: tests/db/email-rate-limit.test.ts -- every case runs as `service_role`
-- (BYPASSRLS, the role the SECRET key gets), which is the point: a cap that
-- holds there is one the leaked secret cannot talk its way out of.
-- STATUS: APPLIED + VERIFIED LIVE 2026-09-02 13:06:20+00. Ledger records 0012
-- (0001-0012, no gaps). pg_trigger reads
-- `BEFORE INSERT ON public.rate_events FOR EACH ROW WHEN ((new.action =
-- 'trek_email'::text))`, tgenabled = 'O'; the function is prosecdef with
-- search_path pinned, anon EXECUTE false.
--
-- STILL OPEN: the edge functions are NOT redeployed -- send-trek-notification is
-- still v11 and send-trek-leave-notification v6, both from 2026-08-25, read back
-- over MCP 2026-09-02. Until they are, the DB refuses the over-cap log row but
-- the old code ignores the insert error and mails anyway, so the concurrent
-- burst this migration exists for still leaks -- and now leaks UNCOUNTED, since
-- the refused row is the one that would have metered it. The same deploy also
-- lands EDGE-004 (the deployed body still compares the webhook secret with
-- `!==`).
-- ============================================================================

-- ============================================================================
-- 0013 — the phone columns must look like phone numbers (2026-09-05)
-- ============================================================================
-- FINDING: 0009 and 0011 mirrored the Zod *length* caps into the database and
-- stopped there. profileUpdateSchema.emergencyContactPhone has always carried
-- `.regex(/^[\d\s+()-]*$/, 'Enter a valid phone number')` as well, and that half
-- stayed in the browser -- where, as with every other rule in src/lib/schemas.ts,
-- it is advisory: the app writes through PostgREST with the publishable key, so
-- the owner of a profile can put a paragraph, a URL or a script tag in
-- emergency_no with one request.
--
-- FIX: the same character class as the Zod rule -- digits, whitespace, +, (, ),
-- - -- on profiles.emergency_no and profiles.phone_no. `\d` and `\s` mean the
-- same thing in a Postgres ARE as in the JS regex, so this is the rule the form
-- already applies and not a re-interpretation of it. `*` not `+`: the empty
-- string passes in Zod (the field is optional) and NULL passes any CHECK, so
-- "unset" stays unset in both spellings.
--
-- Not a validity rule. '+91 (987) 654-3210', '9876543210' and '((((' all pass.
-- What it rejects is the class of value that is not a phone number at all,
-- which is what an unconstrained free-text column collects. Anything narrower
-- would be inventing a national format the form has never asked for.
--
-- phone_no also picks up length <= 20, which 0011 deliberately declined to add
-- on the grounds that there was no Zod rule to mirror. That held for the length
-- on its own and stops holding once the column has a format: a format with no
-- bound still accepts a megabyte of digits, the exact shape the length caps
-- exist to close. 20 is what every other phone field in the app uses
-- (emergencyContactPhone, contactPhone on both company schemas), not a new
-- number. phone_no has no writer in the app -- the profile editor persists
-- emergency_contact/emergency_no only, and get_company_batch_participants reads
-- it into the roster -- so this constrains a column that is only reachable
-- directly, which is the only reason it needed constraining.
--
-- Existing data checked over the read-only MCP immediately before writing:
-- 5 profiles, phone_no set on 1, emergency_no on 3, longest value 10 chars on
-- both, 0 rows failing either regex. No backfill, no NOT VALID staging.
--
-- Test: tests/db/input-constraints.test.ts -- nine cases through asSuperuser, so
-- a rejected write can only have been rejected by the CHECK and not by RLS.
-- STATUS: APPLIED + VERIFIED LIVE 2026-09-05 06:51:12+00. Ledger records 0013
-- (0001-0013, no gaps). pg_constraint reads profiles_phone_no_format,
-- profiles_emergency_no_format and profiles_phone_no_len, all three
-- convalidated -- so they were checked against the existing rows, not staged
-- NOT VALID. The pattern was re-evaluated on the live server too, because the
-- DB suite runs PGlite 18 against production's 17 and `\d`/`\s` inside a
-- bracket expression are ARE extensions: 'call me maybe' and 'a@b.com'
-- rejected, '+91 (987) 654-3210' and '' accepted, 0 violating rows.
-- ============================================================================

-- ============================================================================
-- 0014 — companies.website must carry an http(s) scheme (2026-09-05)
-- ============================================================================
-- FINDING: companyApplicationSchema.website and companyProfileSchema.website
-- were bare z.url(), which validates URL *syntax* and says nothing about the
-- scheme. 'javascript:alert(1)', 'data:text/html,...' and 'vbscript:...' all
-- parse and all passed (verified against the pinned zod@4.5.4). Both values are
-- rendered straight into an href that React does not sanitize --
-- src/app/company/[slug]/page.tsx (public storefront) and
-- src/app/admin/companies/[id]/page.tsx (platform-admin review page, same tab).
--
-- So: anyone signs up, applies for a company with a javascript: website, and
-- the platform admin executes it in their own session by clicking the link on
-- the page where they decide whether to approve the application. Approval then
-- ships it to every visitor of the storefront. Nothing in the database stopped
-- it: pg_constraint on public.companies held companies_name_check and
-- companies_slug_check and no bound on website at all, so the value landed
-- whether it came through the form or straight over PostgREST with the
-- publishable key.
--
-- FIX: check (website ~* '^https?://'). The scheme is the whole rule -- this is
-- deliberately the coarser twin of the Zod check, in the spirit of 0013: it
-- rejects the class of value that cannot be a website link at all, which here
-- means anything the browser would execute rather than fetch, and leaves URL
-- validity to the form. `~*` and not `~` because new URL() lowercases the
-- scheme before Zod's protocol regex sees it, so HTTPS://example.com passes the
-- form and has to pass here. The Zod half moved in the same change to
-- z.url({ protocol: /^https?$/, hostname: z.regexes.domain }).
--
-- '' fails the CHECK on purpose. Both writers (applyForCompany,
-- updateCompanyProfile in src/lib/company.ts) already send `website || null`,
-- so a blank field is NULL and NULL passes any CHECK. Only a caller bypassing
-- the app can produce '', and '' is not a website.
--
-- No length cap, deliberately. 0009/0011 never reached this table -- name,
-- description, contact_email and contact_phone are all still Zod-only -- and
-- website has no Zod cap to mirror, so a number picked here would be invented
-- (0011's stated reason for leaving phone_no alone). Capping the companies
-- table is its own migration.
--
-- Existing data checked over the read-only MCP immediately before writing:
-- 5 companies, website set on 4, longest 18 chars, 0 rows failing the regex.
-- No backfill, no NOT VALID staging.
--
-- Test: tests/db/input-constraints.test.ts -- eleven cases through asSuperuser,
-- so a rejected write can only have been rejected by the CHECK and not by RLS.
-- Plus seven in src/lib/schemas.test.ts for the Zod half.
-- STATUS: APPLIED + VERIFIED LIVE 2026-09-05 11:50:34+00. Ledger records 0014
-- (0001-0014, no gaps). companies_website_scheme reads back from pg_constraint,
-- convalidated -- checked against the existing rows, not staged NOT VALID. The
-- pattern was re-evaluated on the live server rather than trusted from PGlite:
-- javascript:, data:, vbscript:, //evil.example, ftp:// and '' rejected;
-- https://, http:// and HTTPS://example.com accepted.
-- ============================================================================

-- ============================================================================
-- 0015 — the companies table, which 0009/0011 never reached (2026-09-05)
-- ============================================================================
-- FINDING: 0009 capped the six columns the Day 7 pentest named and 0011 swept
-- up the rest, but neither touched public.companies. name, description,
-- contact_email and contact_phone were bounded in src/lib/schemas.ts and
-- nowhere else, on a table any signed-up user reaches over PostgREST with the
-- publishable key -- apply_for_company(), then update your own row. Found while
-- writing 0014, which recorded the gap rather than widening itself.
--
-- FIX: the existing Zod values, not new judgements -- name <= 100,
-- description <= 1000, contact_phone <= 20 -- plus the phone character class
-- 0013 put on profiles.phone_no/emergency_no, which both company schemas have
-- carried in Zod all along. `*` not `+`, so '' passes as it does in Zod.
--
-- contact_email had to have its rule finished before it could be mirrored.
-- z.email() validates shape and imposes no length at all (a 300-character local
-- part parses -- verified against the pinned zod@4.5.4), so there was no number
-- to copy, and inventing one in the database alone would have made it stricter
-- than the form and bounced a value the user had just been told was fine. The
-- cap therefore lands in both places at once, as 0014 did with the scheme rule:
-- contactEmailField now carries .max(254) -- RFC 5321's forward-path limit, so
-- it rejects nothing a mail server would deliver to -- and
-- companies_contact_email_len mirrors it.
--
-- The email format CHECK is deliberately coarser than Zod's: one @, no
-- whitespace, something either side. Zod already refuses a bare a@localhost, a
-- quoted local part and a unicode address, so everything the form accepts
-- passes this and the constraint can only fire on a value that never went near
-- the form. Writing Zod's own email regex into a CHECK would be
-- re-implementing a validity spec in a second language, which is how the two
-- quietly stop agreeing.
--
-- '' passes both new contact checks, as it does in Zod. Deliberately unlike
-- companies_website_scheme (0014), which rejects '': that column is an href
-- sink and its rule is about what a browser would execute.
--
-- Deliberately not here:
--   rejection_reason  no Zod counterpart, and protect_company_admin_fields()
--                     pins it to OLD for anyone who is not a platform admin, so
--                     reject_company()/suspend_company() are the only writers.
--   logo_url,         written by the app from a storage upload path, never
--   cover_image_url   typed into a form. Directly writable and worth their own
--                     look, but a cap picked here would be a guess about a path
--                     format.
--
-- Existing data checked over the read-only MCP immediately before writing:
-- 5 companies, longest name 17, description 31, contact_email 27,
-- contact_phone 13, rejection_reason null on every row, 0 rows failing any of
-- the five rules. No backfill, no NOT VALID staging.
--
-- Test: tests/db/input-constraints.test.ts -- eleven cases through asSuperuser,
-- each length bound asserted on both sides. Plus two in src/lib/schemas.test.ts
-- for the new Zod cap.
-- STATUS: APPLIED + VERIFIED LIVE 2026-09-05 12:01:25+00, after 0014. Ledger
-- records 0015 (0001-0015, no gaps). All six constraints read back from
-- pg_constraint, all convalidated, all matching the text above. Both regexes
-- re-evaluated on the live server (PGlite 18 vs production 17): the ARE check
-- 0013 made mandatory passes -- 'dsdsds' and '\d\s' both fail the phone rule,
-- so the classes are classes and not literal d/s -- 'call me maybe' and
-- 'a@b.com' rejected, '+91 (987) 654-3210' and '' accepted; and on the email
-- rule [:space:] catches 'a b@example.com', with 'not an email',
-- 'https://example.com', 'a@b@c' and '<script>alert(1)</script>' rejected,
-- 'ops@himalayan-trails.com' and '' accepted.
-- ============================================================================

-- ============================================================================
-- 0016 — the four trigger functions authenticated could still call (2026-09-05)
-- ============================================================================
-- FINDING: re-running the security advisors after 0014/0015 surfaced
-- enforce_join_rate_limit, enforce_message_rate_limit,
-- enforce_storage_rate_limit and enforce_trek_email_rate_limit under
-- authenticated_security_definer_function_executable. They are trigger
-- functions, not an API. Not drift: pg_proc on the live database reads
-- authenticated=X/postgres on all four, and schema.sql agrees -- their revokes
-- were written `from public, anon` where every other trigger function in the
-- schema (protect_company_admin_fields, handle_new_user, and the rest) names
-- all three roles.
--
-- IMPACT: none. All four are `returns trigger`, and Postgres refuses a direct
-- call before the body runs --
--
--   select public.enforce_join_rate_limit();
--   ERROR: trigger functions can only be called as triggers   (0A000)
--
-- verified against PGlite rather than assumed. PostgREST does not expose a
-- trigger-returning function over /rest/v1/rpc/ either.
--
-- FIX: revoke execute ... from authenticated on the four, bringing them to the
-- same shape as every other trigger function. The reason to bother with an
-- inert grant is the advisor list: four of its 34 entries were known-inert, and
-- a list padded with those is one nobody reads carefully. Same argument as 0003
-- and the 2026-08-08 anon sweep.
--
-- SAFE BECAUSE: Postgres checks EXECUTE at CREATE TRIGGER time, not at fire
-- time -- the invariant 0001 relied on for the other nine trigger functions
-- (see the 0001 note above). The rate-limit suites are the proof here: if any
-- of the four stopped firing, the join, message, storage and trek-email caps
-- would all fail. 229 tests green after the revoke.
--
-- No data touched; grants only.
-- Test: tests/db/acl.test.ts -- the expected list of definer functions
-- reachable by no client role gains the four names.
-- STATUS: NOT YET APPLIED. Ledger reads 0001-0015. After applying, confirm
-- pg_proc.proacl on all four no longer carries authenticated=X.
-- ============================================================================
