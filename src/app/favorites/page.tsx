// // 

// 'use client';

// import React, { useEffect, useState } from 'react';
// import { createClient } from '@/utils/supabase/client';
// import { useAuth } from '@/contexts/AuthContext';
// import Favcard2 from '@/components/ui/favcard2';

// interface Trek {
//   id: string;
//   title: string;
//   location: string;
//   date: string;
//   cover_image_url: string;
//   difficulty: string;
//   participants_joined: number;
// }

// interface Favorite {
//   user_id: string;
//   trek_id: string;
//   created_at: string;
//   treks: Trek | Trek[] | null; // Allow treks to be a single Trek, array, or null
// }

// export default function FavoritesPage() {
//   const supabase = createClient();
//   const { user } = useAuth();
//   const [favorites, setFavorites] = useState<Favorite[]>([]);
//   const [loading, setLoading] = useState(true);

//   useEffect(() => {
//     const fetchFavorites = async () => {
//       if (!user?.id) {
//         setLoading(false);
//         return;
//       }

//       try {
//         const { data, error } = await supabase
//           .from('favorites')
//           .select(
//             `
//             user_id,
//             trek_id,
//             created_at,
//             treks (
//               id,
//               title,
//               location,
//               date,
//               cover_image_url,
//               difficulty,
//               participants_joined
//             )
//           `
//           )
//           .eq('user_id', user.id);

//         if (error) {
//           console.error('Error fetching favorites:', error);
//           return;
//         }

//         setFavorites((data as Favorite[]) || []);
//       } catch (err) {
//         console.error('Unexpected error fetching favorites:', err);
//       } finally {
//         setLoading(false);
//       }
//     };

//     fetchFavorites();
//   }, [supabase, user?.id]);

//   // Handle removal of a favorite
//   const handleRemoveFavorite = (trekId: string) => {
//     setFavorites((prevFavorites) =>
//       prevFavorites.filter((fav) => fav.trek_id !== trekId)
//     );
//   };

//   if (loading) {
//     return <p className="text-center py-4">Loading favorites...</p>;
//   }

//   if (!favorites.length) {
//     return <p className="text-center py-4">No favorites found.</p>;
//   }

//   return (
//     <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
//       {favorites.map((fav) => {
//         // Normalize treks to always be an array
//         const treks = Array.isArray(fav.treks)
//           ? fav.treks
//           : fav.treks
//             ? [fav.treks]
//             : [];

//         if (!treks.length) {
//           return null; // Skip rendering if no treks
//         }

//         return treks.map((trek) => (
//           <Favcard2
//             key={trek.id}
//             id={trek.id}
//             title={trek.title}
//             location={trek.location}
//             date={trek.date}
//             coverImageUrl={trek.cover_image_url}
//             difficulty={trek.difficulty}
//             participantsCount={trek.participants_joined ?? 0}
//             //onRemove={handleRemoveFavorite} // Pass the remove callback
//           />
//         ));
//       })}
//     </div>
//   );
// }

'use client';

import React, { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import FavCard from '@/components/ui/FavCard';

interface Trek {
  id: string;
  title: string;
  location: string;
  date: string;
  cover_image_url: string;
  difficulty: string;
  participants_joined: number;
}

interface Favorite {
  user_id: string;
  trek_id: string;
  created_at: string;
  treks: Trek | Trek[] | null; // Allow treks to be a single Trek, array, or null
}

export default function FavoritesPage() {
  const supabase = createClient();
  const { user } = useAuth();
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchFavorites = async () => {
      if (!user?.id) {
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('favorites')
          .select(
            `
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
          `
          )
          .eq('user_id', user.id);

        if (error) {
          console.error('Error fetching favorites:', error);
          return;
        }

        setFavorites((data as Favorite[]) || []);
      } catch (err) {
        console.error('Unexpected error fetching favorites:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchFavorites();
  }, [supabase, user?.id]);

  if (loading) {
    return <p className="text-center py-4">Loading favorites...</p>;
  }

  if (!favorites.length) {
    return <p className="text-center py-4">No favorites found.</p>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
      {favorites.map((fav) => {
        // Normalize treks to always be an array
        const treks = Array.isArray(fav.treks)
          ? fav.treks
          : fav.treks
            ? [fav.treks]
            : [];

        if (!treks.length) {
          return null; // Skip rendering if no treks
        }

        return treks.map((trek) => (
          <FavCard
            key={trek.id}
            id={trek.id}
            title={trek.title}
            location={trek.location}
            date={trek.date}
            coverImageUrl={trek.cover_image_url}
            difficulty={trek.difficulty}
            participantsCount={trek.participants_joined ?? 0}
          />
        ));
      })}
    </div>
  );
}

