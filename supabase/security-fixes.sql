-- Consolidated security fixes (source of truth for hardening changes).
-- Apply in order. Each block is idempotent where possible.

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
