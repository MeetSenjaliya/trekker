-- FIX: Update the join function to use SECURITY DEFINER
-- This fixes the "violates row-level security policy" error by allowing the function
-- to bypass RLS policies when creating batches, conversations, and adding participants.

CREATE OR REPLACE FUNCTION public.join_trek_and_chat(
  p_user_id uuid,
  p_trek_id uuid,
  p_batch_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER -- <--- CRITICAL FIX: Runs with owner permissions
SET search_path = public -- Secure search path
AS $$
DECLARE
  v_batch_id uuid;
  v_convo_id uuid;
  v_participant_id uuid;
  v_trek_title text;
BEGIN
  -- 0) Fetch trek title (User improvement)
  SELECT title INTO v_trek_title
  FROM public.treks
  WHERE id = p_trek_id;

  -- Fallback if title not found
  IF v_trek_title IS NULL THEN
    v_trek_title := 'Trek';
  END IF;

  -- 1) Create batch if missing
  INSERT INTO public.trek_batches (trek_id, batch_date)
  VALUES (p_trek_id, p_batch_date)
  ON CONFLICT (trek_id, batch_date) DO NOTHING
  RETURNING id INTO v_batch_id;

  IF v_batch_id IS NULL THEN
    SELECT id INTO v_batch_id
    FROM public.trek_batches
    WHERE trek_id = p_trek_id
      AND batch_date = p_batch_date
    LIMIT 1;
  END IF;

  -- 2) Create conversation for this batch if missing
  -- Uses the trek title in the name now
  INSERT INTO public.conversations (batch_id, name)
  VALUES (v_batch_id, (v_trek_title || ' — ' || p_batch_date::text))
  ON CONFLICT (batch_id) DO NOTHING
  RETURNING id INTO v_convo_id;

  IF v_convo_id IS NULL THEN
    SELECT id INTO v_convo_id
    FROM public.conversations
    WHERE batch_id = v_batch_id
    LIMIT 1;
  END IF;

  -- 3) Insert participant into trek_participants
  INSERT INTO public.trek_participants (user_id, batch_id)
  VALUES (p_user_id, v_batch_id)
  ON CONFLICT (user_id, batch_id) DO NOTHING
  RETURNING id INTO v_participant_id;

  IF v_participant_id IS NULL THEN
    SELECT id INTO v_participant_id
    FROM public.trek_participants
    WHERE user_id = p_user_id AND batch_id = v_batch_id
    LIMIT 1;
  END IF;

  -- 4) Add user to conversation participants
  INSERT INTO public.conversation_participants (conversation_id, user_id)
  VALUES (v_convo_id, p_user_id)
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  -- Final return
  RETURN jsonb_build_object(
    'batch_id', v_batch_id,
    'participant_id', v_participant_id,
    'conversation_id', v_convo_id
  );
END;
$$;
