-- ==============================================================================
-- 🛡️ SUPABASE RLS POLICIES - CHAT & TREK SYSTEMS (+ PROFILES)
-- ==============================================================================
-- This script enables Row Level Security (RLS) and defines policies for:
-- 1. Chat System (Conversations, Participants, Messages)
-- 2. Trek System (Treks, Batches, Participants, Reviews)
-- 3. Profiles (Required for Chat UI)
-- ==============================================================================


-- ==============================================================================
-- 🛠️ HELPER FUNCTIONS
-- ==============================================================================
-- Prevents infinite recursion in RLS policies by providing a clean way to check membership.
-- Security Definer: Runs with supervisor privileges to bypass RLS recursion loops.

CREATE OR REPLACE FUNCTION "public"."is_chat_participant"("conversation_id" uuid) 
RETURNS boolean 
LANGUAGE plpgsql 
SECURITY DEFINER 
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM public.conversation_participants cp 
    WHERE cp.conversation_id = $1 
    AND cp.user_id = auth.uid()
  );
END;
$$;


-- ==============================================================================
-- 💬 CHAT SYSTEM
-- ==============================================================================

-- 1. CONVERSATIONS
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- Select: Users can view conversations they are part of
CREATE POLICY "Users can view their conversations"
ON public.conversations
FOR SELECT
USING (
  public.is_chat_participant(id)
);

-- Insert: Users can create conversations (e.g. if starting a new chat)
-- If only backend does this, you can restrict it.
CREATE POLICY "Users can create conversations"
ON public.conversations
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);


-- 2. CONVERSATION_PARTICIPANTS
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;

-- Select: Users can see WHO is in a conversation, IF they are also in it.
CREATE POLICY "Users can view participants of their chats"
ON public.conversation_participants
FOR SELECT
USING (
  public.is_chat_participant(conversation_id)
);

-- Insert: RESTRICTED TO SYSTEM ONLY (Service Role)
-- As per user update, users cannot join manually via client API.
CREATE POLICY "System adds participants"
ON public.conversation_participants
FOR INSERT
WITH CHECK ( auth.role() = 'service_role' );

-- Delete: Users can leave (remove themselves)
CREATE POLICY "Users can leave conversation"
ON public.conversation_participants
FOR DELETE
USING (user_id = auth.uid());


-- 3. CONVERSATION_MESSAGES
ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;

-- Select: Read messages if you are a participant
CREATE POLICY "Read messages of joined conversations"
ON public.conversation_messages
FOR SELECT
USING (
  public.is_chat_participant(conversation_id)
);

-- Insert: Send messages if you are a participant
CREATE POLICY "Send messages"
ON public.conversation_messages
FOR INSERT
WITH CHECK (
  user_id = auth.uid() 
  AND public.is_chat_participant(conversation_id)
);

-- Update: Edit OWN messages only
CREATE POLICY "Edit own messages"
ON public.conversation_messages
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Delete: Delete OWN messages only
CREATE POLICY "Delete own messages"
ON public.conversation_messages
FOR DELETE
USING (user_id = auth.uid());


-- ==============================================================================
-- 🏔️ TREK SYSTEM
-- ==============================================================================

-- 4. TREKS (Public Read)
ALTER TABLE public.treks ENABLE ROW LEVEL SECURITY;

-- Select: Everyone (Public) can view treks
CREATE POLICY "Public can view treks"
ON public.treks
FOR SELECT
USING (true);


-- 5. TREK_BATCHES (Public Read)
ALTER TABLE public.trek_batches ENABLE ROW LEVEL SECURITY;

-- Select: Everyone (Public) can view upcoming dates
CREATE POLICY "Public can view trek batches"
ON public.trek_batches
FOR SELECT
USING (true);


-- 6. TREK_PARTICIPANTS
ALTER TABLE public.trek_participants ENABLE ROW LEVEL SECURITY;

-- Select: Users can see who is trekking?
CREATE POLICY "Users can see participants in their batches"
ON public.trek_participants
FOR SELECT
USING (
  user_id = auth.uid()
  OR 
  batch_id IN (
    SELECT batch_id FROM public.trek_participants WHERE user_id = auth.uid()
  )
);

-- Insert: Users can join a trek (book for themselves)
CREATE POLICY "Users can join treks"
ON public.trek_participants
FOR INSERT
WITH CHECK (user_id = auth.uid());

-- Delete: Users can cancel their own booking
CREATE POLICY "Users can cancel their booking"
ON public.trek_participants
FOR DELETE
USING (user_id = auth.uid());


-- 7. TREK_REVIEWS
ALTER TABLE public.trek_reviews ENABLE ROW LEVEL SECURITY;

-- Select: Public read for reviews
CREATE POLICY "Public can view reviews"
ON public.trek_reviews
FOR SELECT
USING (true);

-- Insert: Authenticated users can write reviews
CREATE POLICY "Authenticated users can write reviews"
ON public.trek_reviews
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Update/Delete: Own reviews only
CREATE POLICY "Users can edit own reviews"
ON public.trek_reviews
FOR UPDATE
USING (user_id = auth.uid());

CREATE POLICY "Users can delete own reviews"
ON public.trek_reviews
FOR DELETE
USING (user_id = auth.uid());


-- ==============================================================================
-- 👤 USER PROFILES (REQUIRED FOR CHAT NAMES)
-- ==============================================================================

-- 8. PROFILES
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Select: Public can view profiles (Needed to show names in Chat/Treks)
CREATE POLICY "Public can view profiles"
ON public.profiles
FOR SELECT
USING (true);

-- Update: Users can edit their OWN profile
CREATE POLICY "Users can edit own profile"
ON public.profiles
FOR UPDATE
USING (id = auth.uid());
