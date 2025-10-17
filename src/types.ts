// src/types.ts

export interface Trek {
  id: string;
  title: string;
  description?: string;
  location: string;
  date: string;
  cover_image_url: string;
  difficulty: string;
  participants_joined: number | null;
  max_participants?: number;
  whatsapp_group_url?: string;
  meeting_point?: string;
  estimated_cost?: number;
  distance_km?: number;
  duration_hours?: number;
}

export interface Favorite {
  user_id: string;
  trek_id: string;
  created_at: string;
  treks: Trek[]; // can be 0, 1, or many treks
}

export interface TrekParticipant {
  id: string;
  user_id: string;
  trek_id: string;
  joined_at: string;
}
