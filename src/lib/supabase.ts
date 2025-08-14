import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Types for our database tables
export interface User {
  id: string
  email: string
  full_name: string
  avatar_url?: string
  created_at: string
  updated_at: string
}

export interface Trek {
  id: string
  title: string
  description: string
  difficulty: 'Easy' | 'Medium' | 'Hard'
  distance: number
  duration: string
  location: string
  date: string
  organizer_id: string
  max_participants: number
  current_participants: number
  price: number
  image_url?: string
  created_at: string
  updated_at: string
}

export interface TrekParticipant {
  id: string
  trek_id: string
  user_id: string
  status: 'pending' | 'confirmed' | 'cancelled'
  joined_at: string
}

export interface Review {
  id: string
  trek_id: string
  user_id: string
  rating: number
  comment: string
  created_at: string
  updated_at: string
}

