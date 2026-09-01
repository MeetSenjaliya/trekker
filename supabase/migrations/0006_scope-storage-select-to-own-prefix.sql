-- ============================================================================
-- 0006 — scope storage SELECT to the caller's own prefix
--        (public_bucket_allows_listing: avatars, trek-reviews, company-logos,
--         trek-images)
-- ============================================================================
-- §9 and §12.7 gave every bucket a SELECT policy of the shape
-- `using (bucket_id = '<bucket>')` for role `authenticated`. That was written to
-- block ANON listing, and it does. What it does not block is listing by any
-- signed-in user: storage-api's list endpoint is a SELECT over storage.objects,
-- so one account with the publishable key could enumerate every other account's
-- folder — i.e. every user UID, and every filename under it — in all four
-- buckets. The 0001 §10 note calls that deliberate; it is being reversed here.
-- The note's own reasoning is why it is safe to reverse: object URLs do not go
-- through RLS at all. All five buckets are public, so the CDN path
-- (/storage/v1/object/public/...) serves bytes with no session, which is how
-- every image in the app actually resolves — getPublicUrl() builds a string and
-- makes no request. The app has no list(), download() or createSignedUrl() call
-- anywhere (src/, e2e/, supabase/functions/), so nothing reads these buckets
-- through the authenticated path except the upload itself.
--
-- Uploads keep working: upload(..., { upsert: true }) inserts with RETURNING,
-- and RETURNING is checked against the SELECT policy — but every write policy
-- below already confines a writer to the prefix these SELECT policies grant, so
-- a caller can always read back exactly what it was allowed to write.
--
-- Write policies are untouched. Only SELECT changes.

-- ---- avatars ----------------------------------------------------------------
-- Ownership must accept BOTH layouts the write policies accept — avatars/{uid}/file
-- and the legacy flat avatars/{uid}.ext. foldername() drops the last segment, so
-- for a flat name it returns {} and [1] is NULL; a folder-prefix-only policy
-- would leave the 1 flat object live in production outside its own owner's
-- SELECT, and break that owner's next upsert on the RETURNING check.
drop policy if exists "Public can view avatars" on storage.objects;
drop policy if exists "Authenticated users can view avatars" on storage.objects;
drop policy if exists "Authenticated users can view own avatars" on storage.objects;
drop policy if exists "Users can view own avatars" on storage.objects;
create policy "Users can view own avatars" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars'
         and ((storage.foldername(name))[1] = auth.uid()::text
              or name like auth.uid()::text || '.%'));

-- ---- trek-reviews -----------------------------------------------------------
-- Same key layout as avatars minus the flat variant: the write policies only
-- ever accept trek-reviews/{uid}/file, and all 11 live objects match.
drop policy if exists "Public Access" on storage.objects;
drop policy if exists "Authenticated users can view review photos" on storage.objects;
drop policy if exists "Users can view own review photos" on storage.objects;
create policy "Users can view own review photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'trek-reviews'
         and (storage.foldername(name))[1] = auth.uid()::text);

-- ---- company-logos ----------------------------------------------------------
-- Keyed by company_id, so "own prefix" is "a company I belong to".
-- is_company_member, NOT is_company_writable/is_approved_company_member: the
-- status tiers in §16 gate PUBLISHING, and a frozen company's staff still need
-- to see their own branding in the dashboard. Reading back your own file is not
-- the capability those tiers exist to withhold.
drop policy if exists "Authenticated users can view company logos" on storage.objects;
drop policy if exists "Company members can view own logo" on storage.objects;
create policy "Company members can view own logo" on storage.objects
  for select to authenticated
  using (bucket_id = 'company-logos'
         and public.is_company_member(((storage.foldername(name))[1])::uuid));

-- ---- trek-images ------------------------------------------------------------
-- is_company_member for the same reason as company-logos; the approved-only gate
-- stays where it belongs, on insert/update/delete.
drop policy if exists "Authenticated users can view trek images" on storage.objects;
drop policy if exists "Company members can view own trek images" on storage.objects;
create policy "Company members can view own trek images" on storage.objects
  for select to authenticated
  using (bucket_id = 'trek-images'
         and public.is_company_member(((storage.foldername(name))[1])::uuid));

-- ---- trek-profile: nothing to do --------------------------------------------
-- It has no object policies at all, so RLS already denies every authenticated
-- SELECT on it. Its 14 objects are reachable by public URL only, which is the
-- end state this migration puts the other four in.

-- Known edge, stated rather than defended against: the two company buckets cast
-- the first path segment to uuid. A non-uuid FOLDER name there would raise
-- 22P02 on read instead of filtering the row out. Nothing can create one — the
-- insert policies carry the same cast, so an authenticated write with a
-- non-uuid prefix is rejected before the row exists (a flat name yields NULL,
-- not an error, and is simply invisible). Only a service_role write, e.g. a
-- manual dashboard upload into a folder like `temp/`, could introduce one.
-- Live check at time of writing: 0 such objects in either bucket.

-- ============================================================================
-- SUPERSEDES the 0001 §10 advisor note
-- ============================================================================
-- `public_bucket_allows_listing` is no longer accepted for avatars,
-- trek-reviews, company-logos or trek-images. All four now scope SELECT to the
-- caller's own prefix; only trek-profile remains flagged, and it has no SELECT
-- policy to widen. The 0001 text is history and stays as written.

-- ============================================================================
-- RECORD THIS MIGRATION
-- ============================================================================
insert into supabase_migrations.schema_migrations (version, name)
values ('0006', 'scope-storage-select-to-own-prefix')
on conflict (version) do nothing;
