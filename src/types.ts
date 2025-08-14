// src/types.ts

export interface Trek {
  id: string;
  title: string;
  location: string;
  date: string;
  cover_image_url: string;
  difficulty: string;
  participants_joined: number | null;
}

export interface Favorite {
  user_id: string;
  trek_id: string;
  created_at: string;
  treks: Trek[]; // can be 0, 1, or many treks
}
