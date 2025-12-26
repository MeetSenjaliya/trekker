-- 1. Add necessary columns to store multiple images and trek date
ALTER TABLE public.trek_reviews 
ADD COLUMN IF NOT EXISTS photo_urls text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS trek_date date;

-- 2. Enable RLS on the table (if not already enabled)
ALTER TABLE public.trek_reviews ENABLE ROW LEVEL SECURITY;

-- POLICY: Anyone can read reviews
CREATE POLICY "Reviews are viewable by everyone" 
ON public.trek_reviews FOR SELECT 
USING (true);

-- POLICY: Authenticated users can insert their own reviews
CREATE POLICY "Users can create their own reviews" 
ON public.trek_reviews FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = user_id);

-- POLICY: Users can update their own reviews
CREATE POLICY "Users can update their own reviews" 
ON public.trek_reviews FOR UPDATE 
TO authenticated 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- POLICY: Users can delete their own reviews
CREATE POLICY "Users can delete their own reviews" 
ON public.trek_reviews FOR DELETE 
TO authenticated 
USING (auth.uid() = user_id);

-- STORAGE POLICIES
-- 1. Allow public access to view images
CREATE POLICY "Public Access" 
ON storage.objects FOR SELECT 
TO public 
USING (bucket_id = 'trek-reviews');

-- 2. Allow authenticated users to upload images to their own folder
-- Folder structure: trek-reviews/{user_id}/{filename}
CREATE POLICY "Authenticated users can upload review photos" 
ON storage.objects FOR INSERT 
TO authenticated 
WITH CHECK (
  bucket_id = 'trek-reviews' AND 
  (storage.foldername(name))[1] = auth.uid()::text
);

-- 3. Allow users to delete their own review photos
CREATE POLICY "Users can delete their own review photos" 
ON storage.objects FOR DELETE 
TO authenticated 
USING (
  bucket_id = 'trek-reviews' AND 
  (storage.foldername(name))[1] = auth.uid()::text
);
