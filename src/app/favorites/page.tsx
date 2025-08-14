// src/app/favorites/page.tsx

'use client';

import React, { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import FavCard from '@/components/ui/FavCard';
import { Favorite } from '@/types';



// export interface Favorite {
//   user_id: string;
//   trek_id: string;
//   created_at: string;
//   treks: Trek; // single trek object
// }

// export interface Trek {
//   id: string;
//   title: string;
//   location: string;
//   date: string;
//   cover_image_url: string;
//   difficulty: string;
//   participants_joined: number | null;
// }


const FavoritesPage = () => {
  const supabase = createClient();
  const { user } = useAuth();
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchFavorites = async () => {
      if (!user) return;

      const { data, error } = await supabase
        .from('favorites')
        .select(`
          user_id,
          trek_id,
          created_at,
          treks (
            id,
            title,
            location,
            date,
            cover_image_url,
            difficulty,
            participants_joined
          )
        `)
        .eq('user_id', '655b4188-d194-4529-8114-e86c66d3d8ae');

      if (error) {
        console.error('Error fetching favorites:', error.message);
      } else if (data) {
              console.log("Fetched favorites data:", data); // ✅ log the raw data
              data.forEach((fav: any) => {
                console.log("Fetched favorites data user_id:", fav.user_id); // ✅ log the user_id for each favorite
              });


        setFavorites(data as Favorite[]);
      }

      setLoading(false);
    };

    fetchFavorites();
  }, [user, supabase]);

  if (loading) return <p className="text-center">Loading favorites...</p>;

  if (favorites.length === 0) {
    return <p className="text-center">No favorites found.</p>;
  }

return (
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
    {favorites.map((fav) =>
      fav.treks.map((trek) => (
        <FavCard
          key={`${trek.id}`}
          id={trek.id}
          title={trek.title}
          location={trek.location}
          date={trek.date}
          coverImageUrl={trek.cover_image_url}
          difficulty={trek.difficulty}
          participantsCount={trek.participants_joined ?? 0}
        />
      ))
    )}
  </div>
);

};

export default FavoritesPage;
