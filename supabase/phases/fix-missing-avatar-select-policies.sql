-- ============================================================================
-- FIX — restore the missing avatars / trek-reviews SELECT policies (2026-08-05)
-- ============================================================================
-- ⚠️ Confirm the SQL Editor tab is on project dtjmyqogeozrzzbdjokr first:
--    select current_database(), to_regclass('public.rate_events');
--
-- SYMPTOM: uploading an avatar fails with a 400 and the Postgres log shows
--   ERROR: new row violates row-level security policy for table "objects"
-- while the INSERT policy is present and its predicate evaluates true for the
-- path being written.
--
-- CAUSE: `supabase/schema.sql` §9 documents a SELECT policy for both the
-- `avatars` and `trek-reviews` buckets, but neither exists on the live
-- database — live `pg_policies` has SELECT policies for `company-logos` and
-- `trek-images` only. supabase-js `.upload()` makes storage-api run an
-- `INSERT … RETURNING *`, and with RLS enabled a RETURNING clause evaluates
-- SELECT policies against the new row; with no SELECT policy for
-- `authenticated` on that bucket, the write is rejected.
--
-- This stayed invisible because both buckets are `public = true`, so displaying
-- an avatar is served by the CDN without ever consulting RLS. Only the write
-- path was broken.
--
-- These are exactly the policies already written in schema.sql §9 — this file
-- brings the database into line with the documented state, it does not
-- introduce a new rule. Authenticated-only SELECT (not `public`) is the
-- deliberate existing pattern: it blocks anonymous *listing* of the bucket
-- while public CDN URLs keep serving the images.
-- ============================================================================

drop policy if exists "Public can view avatars" on storage.objects;
drop policy if exists "Authenticated users can view own avatars" on storage.objects;
drop policy if exists "Authenticated users can view avatars" on storage.objects;
create policy "Authenticated users can view avatars" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars');

drop policy if exists "Public Access" on storage.objects;
drop policy if exists "Authenticated users can view review photos" on storage.objects;
create policy "Authenticated users can view review photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'trek-reviews');


-- ============================================================================
-- VERIFY — expect 4 SELECT policies (avatars, trek-reviews, company-logos,
-- trek-images)
-- ============================================================================
-- select policyname, permissive, cmd, roles::text
--   from pg_policies
--  where schemaname = 'storage' and tablename = 'objects' and cmd = 'SELECT'
--  order by policyname;
--
-- Then retry the avatar upload. If it STILL fails with the same RLS error, the
-- diagnosis above is wrong — isolate my rate-limit trigger by dropping it and
-- retrying:
--   drop trigger if exists storage_objects_rate_limit on storage.objects;
-- ============================================================================
