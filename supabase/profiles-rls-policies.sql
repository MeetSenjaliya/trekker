-- Enable RLS on profiles table
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- 1. Allow users to view their own profile
CREATE POLICY "Users can view own profile"
ON profiles FOR SELECT
TO authenticated
USING (auth.uid() = id);

-- 2. Allow users to insert their own profile
CREATE POLICY "Users can insert own profile"
ON profiles FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);

-- 3. Allow users to update their own profile
CREATE POLICY "Users can update own profile"
ON profiles FOR UPDATE
TO authenticated
USING (auth.uid() = id);

-- 4. Allow public to view profiles (optional, if you want public profiles)
-- CREATE POLICY "Public profiles are viewable by everyone"
-- ON profiles FOR SELECT
-- TO public
-- USING (true);

-- Enable RLS on user_stats table
ALTER TABLE user_stats ENABLE ROW LEVEL SECURITY;

-- 5. Allow users to view their own stats
CREATE POLICY "Users can view own stats"
ON user_stats FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Enable RLS on user_monthly_activity table
ALTER TABLE user_monthly_activity ENABLE ROW LEVEL SECURITY;

-- 6. Allow users to view their own monthly activity
CREATE POLICY "Users can view own monthly activity"
ON user_monthly_activity FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Enable RLS on favorites table
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;

-- 7. Allow users to view their own favorites
CREATE POLICY "Users can see their favorites"
ON favorites FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- 8. Allow users to insert their own favorites
CREATE POLICY "Users can favorite treks"
ON favorites FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- 9. Allow users to delete their own favorites
CREATE POLICY "Users can remove favorites"
ON favorites FOR DELETE
TO authenticated
USING (auth.uid() = user_id);
-- ============================================
-- RLS POLICIES FOR TREK_BATCHES TABLE
-- ============================================

-- Enable RLS
ALTER TABLE trek_batches ENABLE ROW LEVEL SECURITY;

-- 1. Anyone can view trek batches (public read)
-- This allows users to see available trek dates/batches
CREATE POLICY "Anyone can view trek batches"
ON trek_batches FOR SELECT
TO public
USING (true);

-- 2. Authenticated users can create batches
-- Typically done through the join_trek_and_chat function
-- Or by trek organizers when creating a trek
CREATE POLICY "Authenticated users can create batches"
ON trek_batches FOR INSERT
TO authenticated
WITH CHECK (true);

-- 3. Authenticated users can update batches (optional)
-- You might want to restrict this to trek organizers only
-- For now, allowing all authenticated users
CREATE POLICY "Authenticated users can update batches"
ON trek_batches FOR UPDATE
TO authenticated
USING (true);

-- 4. Authenticated users can delete batches (optional)
-- You might want to restrict this to trek organizers only
CREATE POLICY "Authenticated users can delete batches"
ON trek_batches FOR DELETE
TO authenticated
USING (true);

-- ============================================
-- RLS POLICIES FOR TREK_PARTICIPANTS TABLE
-- ============================================

-- Enable RLS
ALTER TABLE trek_participants ENABLE ROW LEVEL SECURITY;

-- 1. Anyone can view trek participants (public read)
-- This allows users to see who has joined a trek
CREATE POLICY "Anyone can view trek participants"
ON trek_participants FOR SELECT
TO public
USING (true);

-- 2. Users can join treks (insert their own participation)
-- The WITH CHECK ensures users can only add themselves, not others
CREATE POLICY "Users can join treks"
ON trek_participants FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- 3. Users can update their own participation
-- For example, updating status or other details
CREATE POLICY "Users can update own participation"
ON trek_participants FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

-- 4. Users can leave treks (delete their own participation)
CREATE POLICY "Users can leave treks"
ON trek_participants FOR DELETE
TO authenticated
USING (auth.uid() = user_id);


-- ==================================