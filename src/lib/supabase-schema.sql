-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.conversation_messages (
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  message text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  updated_at timestamp with time zone,
  is_deleted boolean DEFAULT false,
  reply_to uuid,
  reactions jsonb DEFAULT '{}'::jsonb,
  CONSTRAINT conversation_messages_pkey PRIMARY KEY (created_at, id),
  CONSTRAINT conversation_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT conversation_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id)
);
CREATE TABLE public.conversation_participants (
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  joined_at timestamp with time zone DEFAULT now(),
  CONSTRAINT conversation_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT conversation_participants_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id)
);
CREATE TABLE public.conversations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  batch_id uuid UNIQUE,
  name text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT conversations_pkey PRIMARY KEY (id),
  CONSTRAINT conversations_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.trek_batches(id)
);
CREATE TABLE public.favorites (
  user_id uuid NOT NULL,
  trek_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT favorites_trek_id_fkey FOREIGN KEY (trek_id) REFERENCES public.treks(id),
  CONSTRAINT favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.profiles (
  id uuid NOT NULL,
  full_name text,
  avatar_url text,
  bio text,
  emergency_contact text,
  created_at timestamp with time zone DEFAULT now(),
  email text NOT NULL UNIQUE,
  age integer,
  Gender USER-DEFINED,
  experience_level USER-DEFINED,
  phone_no character varying,
  emergency_no character varying,
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
CREATE TABLE public.trek_batches (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  trek_id uuid NOT NULL,
  batch_date date NOT NULL,
  max_participants integer,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT trek_batches_pkey PRIMARY KEY (id),
  CONSTRAINT trek_batches_trek_id_fkey FOREIGN KEY (trek_id) REFERENCES public.treks(id)
);
CREATE TABLE public.trek_participants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  batch_id uuid,
  joined_at timestamp with time zone DEFAULT now(),
  CONSTRAINT trek_participants_pkey PRIMARY KEY (id),
  CONSTRAINT trek_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT trek_participants_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.trek_batches(id)
);
CREATE TABLE public.trek_reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  trek_id uuid,
  user_id uuid,
  rating integer CHECK (rating >= 1 AND rating <= 5),
  comment text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT trek_reviews_pkey PRIMARY KEY (id),
  CONSTRAINT trek_reviews_trek_id_fkey FOREIGN KEY (trek_id) REFERENCES public.treks(id),
  CONSTRAINT trek_reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.treks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  location text,
  cover_image_url text,
  difficulty USER-DEFINED NOT NULL,
  distance_km numeric,
  duration_hours numeric,
  meeting_point text,
  max_participants integer,
  estimated_cost numeric,
  gear_checklist ARRAY,
  rating smallint,
  plan text,
  meeting_point2 text,
  participants_joined smallint,
  CONSTRAINT treks_pkey PRIMARY KEY (id)
);
CREATE TABLE public.user_monthly_activity (
  user_id uuid NOT NULL,
  month date NOT NULL CHECK (EXTRACT(day FROM month) = 1::numeric),
  treks_joined integer DEFAULT 0,
  photos_shared integer DEFAULT 0,
  reviews_written integer DEFAULT 0,
  distance_km numeric DEFAULT 0,
  CONSTRAINT user_monthly_activity_pkey PRIMARY KEY (user_id, month),
  CONSTRAINT user_monthly_activity_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.user_stats (
  user_id uuid NOT NULL,
  treks_completed integer DEFAULT 0 CHECK (treks_completed >= 0),
  treks_organised integer DEFAULT 0 CHECK (treks_organised >= 0),
  total_distance_km numeric DEFAULT 0 CHECK (total_distance_km >= 0::numeric),
  avg_rating numeric DEFAULT 0 CHECK (avg_rating >= 0::numeric AND avg_rating <= 5::numeric),
  last_updated timestamp with time zone DEFAULT now(),
  CONSTRAINT user_stats_pkey PRIMARY KEY (user_id),
  CONSTRAINT user_stats_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);




CREATE OR REPLACE FUNCTION public.join_trek_and_chat(
  p_user_id uuid,
  p_trek_id uuid,
  p_batch_date date
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_batch_id uuid;
  v_convo_id uuid;
  v_participant_id uuid;
BEGIN
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
  INSERT INTO public.conversations (batch_id, name)
  VALUES (v_batch_id, ('Chat — ' || p_batch_date::text))
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
