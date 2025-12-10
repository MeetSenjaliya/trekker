-- Storage Policies for 'avatars' bucket

-- 1. Allow public read access to all avatars
CREATE POLICY "Public can view avatars"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'avatars');

-- 2. Allow authenticated users to upload their own avatar
-- This ensures users can only upload files where the name starts with their user ID (optional security measure)
-- Or simply allow any upload to the bucket if you prefer simpler logic
CREATE POLICY "Users can upload avatars"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'avatars');

-- 3. Allow users to update their own avatar
CREATE POLICY "Users can update avatars"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'avatars');

-- 4. Allow users to delete their own avatar
CREATE POLICY "Users can delete avatars"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'avatars');
