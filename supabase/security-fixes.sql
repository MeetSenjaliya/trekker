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
