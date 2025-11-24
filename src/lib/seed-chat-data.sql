-- Seed Data for Trek Group Chats

-- 1. Create Sample Users (Profiles)
-- Note: In a real scenario, these would be linked to auth.users. 
-- For testing, we'll insert into profiles directly, but this might fail foreign key constraints if auth.users don't exist.
-- Ideally, you should create users via Supabase Auth API, but here is the SQL to populate profiles assuming auth users exist or constraints are disabled/mocked.
-- For this seed script, we will assume we are running this in the SQL Editor where we can't easily create auth users.
-- So we will use a workaround: We will select existing users if any, or just insert profiles if constraints allow.

-- Let's assume we have at least 3 users. If not, you might need to sign up 3 users in your app first.
-- Here we will update existing profiles or insert mock ones if possible.

-- Mock Data Variables (We'll use temporary table to store user IDs for reference)
CREATE TEMP TABLE temp_users (
    id UUID,
    name TEXT,
    email TEXT
);

-- Try to get existing users from profiles, or insert placeholders if you have disabled FK for testing (not recommended for prod)
-- BETTER APPROACH: We will use the existing profiles in your database.
-- Please ensure you have at least 2-3 users signed up in your application.

-- 2. Create Sample Treks
-- We'll create a few treks. The triggers we added will automatically create the conversations.

INSERT INTO treks (title, description, difficulty, distance, duration, location, date, organizer_id, max_participants, price, gear_list, meeting_point)
SELECT 
    'Sunset Valley Hike', 
    'A beautiful evening hike to watch the sunset.', 
    'Easy', 
    5.0, 
    '3 hours', 
    'Valley of Flowers', 
    NOW() + INTERVAL '5 days', 
    id, -- Use the first user found as organizer
    20, 
    50.00, 
    ARRAY['Water', 'Camera'], 
    'Valley Entrance'
FROM profiles 
LIMIT 1;

INSERT INTO treks (title, description, difficulty, distance, duration, location, date, organizer_id, max_participants, price, gear_list, meeting_point)
SELECT 
    'Mountain Peak Challenge', 
    'A rigorous climb to the summit.', 
    'Hard', 
    15.0, 
    '8 hours', 
    'Mount Everest Base', 
    NOW() + INTERVAL '10 days', 
    id, -- Use the first user found as organizer
    10, 
    200.00, 
    ARRAY['Climbing Gear', 'Oxygen'], 
    'Base Camp'
FROM profiles 
LIMIT 1;

-- 3. Add Participants to Treks
-- This will trigger the sync to conversation_participants

-- Get the Trek IDs we just created
WITH new_treks AS (
    SELECT id, organizer_id FROM treks ORDER BY created_at DESC LIMIT 2
),
other_users AS (
    SELECT id FROM profiles WHERE id NOT IN (SELECT organizer_id FROM new_treks) LIMIT 5
)
INSERT INTO trek_participants (trek_id, user_id, status)
SELECT 
    t.id,
    u.id,
    'confirmed'
FROM new_treks t
CROSS JOIN other_users u;

-- 4. Insert Sample Messages
-- We need to find the conversation IDs for these treks and insert messages.

DO $$
DECLARE
    v_trek_id UUID;
    v_conv_id UUID;
    v_user_id UUID;
    v_organizer_id UUID;
BEGIN
    -- Get a trek
    SELECT id, organizer_id INTO v_trek_id, v_organizer_id FROM treks ORDER BY created_at DESC LIMIT 1;
    
    -- Get its conversation
    SELECT id INTO v_conv_id FROM conversations WHERE trek_id = v_trek_id;
    
    -- Get a participant (not organizer)
    SELECT user_id INTO v_user_id FROM conversation_participants WHERE conversation_id = v_conv_id AND user_id != v_organizer_id LIMIT 1;
    
    IF v_conv_id IS NOT NULL AND v_user_id IS NOT NULL THEN
        -- Message from Organizer
        INSERT INTO messages (conversation_id, sender_id, content) VALUES 
        (v_conv_id, v_organizer_id, 'Welcome everyone to the trek! Really excited to see you all.');
        
        -- Message from Participant
        INSERT INTO messages (conversation_id, sender_id, content) VALUES 
        (v_conv_id, v_user_id, 'Hi! Thanks for organizing. What time should we meet exactly?');
        
        -- Reply from Organizer
        INSERT INTO messages (conversation_id, sender_id, content) VALUES 
        (v_conv_id, v_organizer_id, 'We meet at 7 AM sharp at the entrance.');
        
        -- Another message
        INSERT INTO messages (conversation_id, sender_id, content) VALUES 
        (v_conv_id, v_user_id, 'Got it. Bringing my camera!');
    END IF;
END $$;
