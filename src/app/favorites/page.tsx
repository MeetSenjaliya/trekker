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
import { Heart, MapPin, Calendar, Users, ArrowRight } from 'lucide-react';
import Link from 'next/link';

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
  treks: Trek | Trek[] | null;
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

  const removeFavorite = async (trekId: string) => {
    if (!user?.id) return;

    try {
      const { error } = await supabase
        .from('favorites')
        .delete()
        .eq('user_id', user.id)
        .eq('trek_id', trekId);

      if (error) {
        console.error('Error removing favorite:', error);
        return;
      }

      // Update local state
      setFavorites(prev => prev.filter(fav => fav.trek_id !== trekId));
    } catch (err) {
      console.error('Error removing favorite:', err);
    }
  };

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case 'Easy':
        return 'bg-green-100 text-green-800';
      case 'Moderate':
        return 'bg-yellow-100 text-yellow-800';
      case 'Hard':
        return 'bg-red-100 text-red-800';
      case 'Expert':
        return 'bg-purple-100 text-purple-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-[#ffffff] flex items-center justify-center px-4">
        <div className="text-center">
          <Heart className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-[#111618] mb-2">Please Log In</h2>
          <p className="text-[#617d89]">You need to log in to view your favorite treks.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#ffffff] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#27b1ec] mx-auto mb-4"></div>
          <p className="text-[#617d89]">Loading your favorite treks...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#ffffff] text-[#111618]">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-[#f0f3f4]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-40 py-12">
          <div className="mb-10">
            <h1 className="text-4xl font-extrabold tracking-tight text-[#111618]">
              My Favorite Treks
            </h1>
            <p className="mt-2 text-lg text-[#617d89]">
              Your collection of saved and bookmarked adventures.
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 px-4 sm:px-6 lg:px-40 py-12">
        <div className="max-w-5xl mx-auto">
          {!favorites.length ? (
            <div className="text-center py-16">
              <Heart className="w-24 h-24 text-gray-300 mx-auto mb-6" />
              <h2 className="text-2xl font-bold text-[#111618] mb-4">No Favorites Yet</h2>
              <p className="text-[#617d89] mb-8 max-w-md mx-auto">
                Start exploring treks and click the heart icon to save your favorites here.
              </p>
              <Link
                href="/explore"
                className="inline-flex items-center px-6 py-3 bg-[#27b1ec] text-white font-semibold rounded-lg hover:bg-opacity-90 transition-colors"
              >
                Explore Treks
                <ArrowRight className="ml-2 w-4 h-4" />
              </Link>
            </div>
          ) : (
            <div className="grid gap-8">
              {favorites.map((fav) => {
                const treks = Array.isArray(fav.treks)
                  ? fav.treks
                  : fav.treks
                    ? [fav.treks]
                    : [];

                if (!treks.length) return null;

                return treks.map((trek) => (
                  <div key={trek.id} className="flex flex-col md:flex-row items-center bg-white rounded-2xl shadow-lg overflow-hidden transition-shadow hover:shadow-2xl">
                    {/* Image Section */}
                    <div className="md:w-1/3 w-full">
                      <img
                        src={trek.cover_image_url || 'https://images.unsplash.com/photo-1551632811-561732d1e306?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=2070&q=80'}
                        alt={trek.title}
                        className="h-64 w-full object-cover"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.src = 'https://images.unsplash.com/photo-1551632811-561732d1e306?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=2070&q=80';
                        }}
                      />
                    </div>
                    
                    {/* Content Section */}
                    <div className="p-6 flex-1 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-semibold uppercase tracking-wider text-[#27b1ec]">
                            {trek.location}
                          </p>
                          <button
                            onClick={() => removeFavorite(trek.id)}
                            className="text-[#617d89] hover:text-[#27b1ec] transition-colors"
                            title="Remove from favorites"
                          >
                            <Heart className="w-6 h-6 fill-current text-red-500" />
                          </button>
                        </div>
                        
                        <h3 className="mt-2 text-2xl font-bold leading-tight text-[#111618]">
                          {trek.title}
                        </h3>
                        
                        <div className="flex flex-wrap gap-4 mt-3 mb-4">
                          <div className="flex items-center gap-2 text-sm text-[#617d89]">
                            <MapPin className="w-4 h-4" />
                            <span>{trek.location}</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-[#617d89]">
                            <Calendar className="w-4 h-4" />
                            <span>{new Date(trek.date).toLocaleDateString()}</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-[#617d89]">
                            <Users className="w-4 h-4" />
                            <span>{trek.participants_joined || 0} joined</span>
                          </div>
                        </div>
                        
                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${getDifficultyColor(trek.difficulty)}`}>
                          {trek.difficulty}
                        </span>
                      </div>
                      
                      <div className="mt-6 flex items-center justify-between">
                        <Link
                          href={`/trek/${trek.id}`}
                          className="inline-block rounded-full bg-[#27b1ec] px-6 py-3 text-base font-bold text-white shadow-md hover:bg-opacity-90 transition"
                        >
                          View Details
                        </Link>
                      </div>
                    </div>
                  </div>
                ));
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
