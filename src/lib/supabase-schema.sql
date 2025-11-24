-- Enable Row Level Security
ALTER DATABASE postgres SET "app.jwt_secret" TO 'your-jwt-secret';

-- Create profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  experience_level TEXT CHECK (experience_level IN ('Beginner', 'Intermediate', 'Expert')),
  favorite_trek_types TEXT[],
  emergency_contact_name TEXT,
  emergency_contact_relationship TEXT,
  emergency_contact_phone TEXT,
  privacy_setting TEXT CHECK (privacy_setting IN ('Public', 'Private', 'Joined Treks Only')) DEFAULT 'Public',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create treks table
CREATE TABLE IF NOT EXISTS treks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  difficulty TEXT CHECK (difficulty IN ('Easy', 'Medium', 'Hard')) NOT NULL,
  distance DECIMAL NOT NULL,
  duration TEXT NOT NULL,
  location TEXT NOT NULL,
  date TIMESTAMPTZ NOT NULL,
  organizer_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  max_participants INTEGER NOT NULL DEFAULT 10,
  current_participants INTEGER NOT NULL DEFAULT 0,
  price DECIMAL NOT NULL DEFAULT 0,
  image_url TEXT,
  gear_list TEXT[],
  meeting_point TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create trek_participants table
CREATE TABLE IF NOT EXISTS trek_participants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trek_id UUID REFERENCES treks(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  status TEXT CHECK (status IN ('pending', 'confirmed', 'cancelled')) DEFAULT 'pending',
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(trek_id, user_id)
);

-- Create reviews table
CREATE TABLE IF NOT EXISTS reviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trek_id UUID REFERENCES treks(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5) NOT NULL,
  comment TEXT,
  photos TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(trek_id, user_id)
);

-- Create function to increment participant count
CREATE OR REPLACE FUNCTION increment_participants(trek_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE treks 
  SET current_participants = current_participants + 1,
      updated_at = NOW()
  WHERE id = trek_id;
END;
$$ LANGUAGE plpgsql;

-- Create function to decrement participant count
CREATE OR REPLACE FUNCTION decrement_participants(trek_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE treks 
  SET current_participants = GREATEST(current_participants - 1, 0),
      updated_at = NOW()
  WHERE id = trek_id;
END;
$$ LANGUAGE plpgsql;

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE treks ENABLE ROW LEVEL SECURITY;
ALTER TABLE trek_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Public profiles are viewable by everyone" ON profiles
  FOR SELECT USING (true);

CREATE POLICY "Users can insert their own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Treks policies
CREATE POLICY "Treks are viewable by everyone" ON treks
  FOR SELECT USING (true);

CREATE POLICY "Authenticated users can create treks" ON treks
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update their own treks" ON treks
  FOR UPDATE USING (auth.uid() = organizer_id);

CREATE POLICY "Users can delete their own treks" ON treks
  FOR DELETE USING (auth.uid() = organizer_id);

-- Trek participants policies
CREATE POLICY "Trek participants are viewable by everyone" ON trek_participants
  FOR SELECT USING (true);

CREATE POLICY "Authenticated users can join treks" ON trek_participants
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update their own participation" ON trek_participants
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can cancel their own participation" ON trek_participants
  FOR DELETE USING (auth.uid() = user_id);

-- Reviews policies
CREATE POLICY "Reviews are viewable by everyone" ON reviews
  FOR SELECT USING (true);

CREATE POLICY "Authenticated users can create reviews" ON reviews
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update their own reviews" ON reviews
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own reviews" ON reviews
  FOR DELETE USING (auth.uid() = user_id);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_treks_organizer_id ON treks(organizer_id);
CREATE INDEX IF NOT EXISTS idx_treks_date ON treks(date);
CREATE INDEX IF NOT EXISTS idx_treks_difficulty ON treks(difficulty);
CREATE INDEX IF NOT EXISTS idx_trek_participants_trek_id ON trek_participants(trek_id);
CREATE INDEX IF NOT EXISTS idx_trek_participants_user_id ON trek_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_trek_id ON reviews(trek_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user_id ON reviews(user_id);

-- Insert sample data
INSERT INTO treks (title, description, difficulty, distance, duration, location, date, organizer_id, max_participants, price, gear_list, meeting_point) VALUES
('Mountaineering Expedition in the Alps', 'Conquer challenging peaks and witness breathtaking panoramic views in the heart of the Alps.', 'Hard', 15.0, '8 hours', 'Swiss Alps', '2024-08-15 08:00:00+00', (SELECT id FROM profiles LIMIT 1), 15, 500.00, ARRAY['Mountaineering boots', 'Crampons', 'Ice axe', 'Harness', 'Ropes', 'Helmet', 'Warm layers', 'Waterproof jacket and pants', 'Gloves and hat', 'Backpack'], 'Base of the mountain at 7:30 AM'),
('Himalayan Heights', 'Experience the majestic beauty of the Himalayas on this challenging trek.', 'Hard', 12.0, '6 hours', 'Nepal', '2024-06-15 06:00:00+00', (SELECT id FROM profiles LIMIT 1), 12, 300.00, ARRAY['Hiking boots', 'Warm clothing', 'Sleeping bag', 'Trekking poles'], 'Kathmandu base camp'),
('Rocky Mountain Adventure', 'Explore the stunning Rocky Mountains with experienced guides.', 'Medium', 8.0, '4 hours', 'Colorado, USA', '2024-05-20 09:00:00+00', (SELECT id FROM profiles LIMIT 1), 10, 150.00, ARRAY['Hiking boots', 'Water bottle', 'Snacks', 'Rain jacket'], 'Rocky Mountain National Park entrance');

-- Chat Feature Tables

-- Create conversations table
CREATE TABLE IF NOT EXISTS conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT CHECK (type IN ('direct', 'group')) DEFAULT 'direct',
  name TEXT, -- For group chats
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create conversation_participants table
CREATE TABLE IF NOT EXISTS conversation_participants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  last_read_at TIMESTAMPTZ DEFAULT NOW(),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(conversation_id, user_id)
);

-- Create messages table
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
  sender_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Helper function to check participation (prevents RLS recursion)
CREATE OR REPLACE FUNCTION public.is_conversation_participant(_conversation_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM conversation_participants 
    WHERE conversation_id = _conversation_id 
    AND user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS Policies

-- Conversations: Users can see conversations they are participants in
CREATE POLICY "Users can view their own conversations" ON conversations
  FOR SELECT USING (
    is_conversation_participant(id)
  );

CREATE POLICY "Users can create conversations" ON conversations
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Participants: Users can see participants of conversations they belong to
CREATE POLICY "Users can view participants of their conversations" ON conversation_participants
  FOR SELECT USING (
    is_conversation_participant(conversation_id)
  );

CREATE POLICY "Users can join conversations" ON conversation_participants
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Messages: Users can see messages in conversations they belong to
CREATE POLICY "Users can view messages in their conversations" ON messages
  FOR SELECT USING (
    is_conversation_participant(conversation_id)
  );

CREATE POLICY "Users can insert messages in their conversations" ON messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id AND
    is_conversation_participant(conversation_id)
  );

CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

-- Trek Group Chat Enhancements

-- Add trek_id to conversations
ALTER TABLE conversations 
ADD COLUMN IF NOT EXISTS trek_id UUID REFERENCES treks(id) ON DELETE CASCADE;

-- Ensure one conversation per trek
ALTER TABLE conversations 
ADD CONSTRAINT unique_trek_conversation UNIQUE (trek_id);

-- Function to create conversation when a trek is created
CREATE OR REPLACE FUNCTION public.create_trek_conversation()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO conversations (type, name, trek_id)
  VALUES ('group', NEW.title, NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create conversation on trek creation
DROP TRIGGER IF EXISTS on_trek_created ON treks;
CREATE TRIGGER on_trek_created
  AFTER INSERT ON treks
  FOR EACH ROW EXECUTE PROCEDURE public.create_trek_conversation();

-- Function to add organizer to the chat
CREATE OR REPLACE FUNCTION public.add_organizer_to_chat()
RETURNS TRIGGER AS $$
DECLARE
  v_conversation_id UUID;
BEGIN
  SELECT id INTO v_conversation_id FROM conversations WHERE trek_id = NEW.id;
  
  -- If conversation exists (it should due to previous trigger, but safety check)
  IF v_conversation_id IS NOT NULL THEN
      INSERT INTO conversation_participants (conversation_id, user_id)
      VALUES (v_conversation_id, NEW.organizer_id)
      ON CONFLICT DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to add organizer when conversation is created
DROP TRIGGER IF EXISTS on_trek_conversation_created ON conversations;
CREATE TRIGGER on_trek_conversation_created
  AFTER INSERT ON conversations
  FOR EACH ROW 
  WHEN (NEW.trek_id IS NOT NULL)
  EXECUTE PROCEDURE public.add_organizer_to_chat();

-- Function to sync trek participants to chat
CREATE OR REPLACE FUNCTION public.sync_trek_participant_to_chat()
RETURNS TRIGGER AS $$
DECLARE
  v_conversation_id UUID;
BEGIN
  -- Find the conversation for this trek
  SELECT id INTO v_conversation_id FROM conversations WHERE trek_id = NEW.trek_id;
  
  IF v_conversation_id IS NOT NULL THEN
    INSERT INTO conversation_participants (conversation_id, user_id)
    VALUES (v_conversation_id, NEW.user_id)
    ON CONFLICT DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to sync participants when they join a trek
DROP TRIGGER IF EXISTS on_trek_participant_joined ON trek_participants;
CREATE TRIGGER on_trek_participant_joined
  AFTER INSERT ON trek_participants
  FOR EACH ROW EXECUTE PROCEDURE public.sync_trek_participant_to_chat();


