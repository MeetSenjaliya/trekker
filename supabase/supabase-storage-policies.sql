-- Storage Policies for 'avatars' bucket
-- NOTE: storage-setup.sql is the idempotent source of truth for these
-- policies. This file is kept in sync; prefer applying storage-setup.sql.

-- Ownership check: the object path must belong to the calling user. Two
-- upload shapes exist in the app, so both are accepted:
--   * folder-based  avatars/{uid}/{file}   (profile/edit/page.tsx)
--   * root-based    avatars/{uid}.{ext}    (edits/page.tsx)

-- 1. Allow public read access to all avatars
DROP POLICY IF EXISTS "Public can view avatars" ON storage.objects;
CREATE POLICY "Public can view avatars"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'avatars');

-- 2. Allow authenticated users to upload only their own avatar
DROP POLICY IF EXISTS "Users can upload avatars" ON storage.objects;
CREATE POLICY "Users can upload avatars"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars' AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR name LIKE auth.uid()::text || '.%'
  )
);

-- 3. Allow users to update only their own avatar
DROP POLICY IF EXISTS "Users can update avatars" ON storage.objects;
CREATE POLICY "Users can update avatars"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'avatars' AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR name LIKE auth.uid()::text || '.%'
  )
)
WITH CHECK (
  bucket_id = 'avatars' AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR name LIKE auth.uid()::text || '.%'
  )
);

-- 4. Allow users to delete only their own avatar
DROP POLICY IF EXISTS "Users can delete avatars" ON storage.objects;
CREATE POLICY "Users can delete avatars"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'avatars' AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR name LIKE auth.uid()::text || '.%'
  )
);
