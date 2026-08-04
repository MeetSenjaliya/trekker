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
