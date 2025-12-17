'use client';

import React, { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Heart, MapPin, Users, ArrowRight } from 'lucide-react';
import SnowEffect from '@/components/ui/SnowEffect';
import Link from 'next/link';

interface Trek {
  id: string;
  title: string;
  location: string;
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
        return 'bg-green-500/20 text-green-300 border border-green-500/30';
      case 'Moderate':
        return 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30';
      case 'Hard':
        return 'bg-red-500/20 text-red-300 border border-red-500/30';
      case 'Expert':
        return 'bg-purple-500/20 text-purple-300 border border-purple-500/30';
      default:
        return 'bg-gray-500/20 text-gray-300 border border-gray-500/30';
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen relative overflow-hidden flex items-center justify-center px-4" style={{ background: 'linear-gradient(to bottom, #1b2735 0%, #090a0f 100%)' }}>
        <SnowEffect />
        <div className="text-center relative z-10 bg-white/5 backdrop-blur-md p-8 rounded-2xl border border-white/10 shadow-2xl">
          <Heart className="w-16 h-16 text-gray-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Please Log In</h2>
          <p className="text-blue-100/70">You need to log in to view your favorite treks.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen relative overflow-hidden flex items-center justify-center" style={{ background: 'linear-gradient(to bottom, #1b2735 0%, #090a0f 100%)' }}>
        <SnowEffect />
        <div className="text-center relative z-10">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400 mx-auto mb-4"></div>
          <p className="text-blue-100/70">Loading your favorite treks...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative overflow-hidden text-white" style={{ background: 'linear-gradient(to bottom, #1b2735 0%, #090a0f 100%)' }}>
      <SnowEffect />

      {/* Header */}
      <div className="bg-white/5 backdrop-blur-md border-b border-white/10 relative z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-40 py-12">
          <div className="mb-10">
            <h1 className="text-4xl font-extrabold tracking-tight text-white drop-shadow-md">
              My Favorite Treks
            </h1>
            <p className="mt-2 text-lg text-blue-100/70 font-light">
              Your collection of saved and bookmarked adventures.
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 px-4 sm:px-6 lg:px-40 py-12 relative z-10">
        <div className="max-w-5xl mx-auto">
          {!favorites.length ? (
            <div className="text-center py-16 bg-white/5 backdrop-blur-sm rounded-3xl border border-white/10">
              <Heart className="w-24 h-24 text-gray-400/50 mx-auto mb-6" />
              <h2 className="text-2xl font-bold text-white mb-4">No Favorites Yet</h2>
              <p className="text-blue-100/60 mb-8 max-w-md mx-auto">
                Start exploring treks and click the heart icon to save your favorites here.
              </p>
              <Link
                href="/explore"
                className="inline-flex items-center px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-500 text-white font-semibold rounded-full hover:from-blue-500 hover:to-blue-400 transition-all shadow-lg hover:shadow-blue-500/25"
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
                  <div key={trek.id} className="flex flex-col md:flex-row items-center bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl shadow-xl overflow-hidden transition-all hover:bg-white/10 hover:shadow-2xl hover:-translate-y-1">
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
                          <p className="text-sm font-semibold uppercase tracking-wider text-blue-300">
                            {trek.location}
                          </p>
                          <button
                            onClick={() => removeFavorite(trek.id)}
                            className="text-gray-400 hover:text-red-500 transition-colors bg-white/5 p-2 rounded-full hover:bg-white/10"
                            title="Remove from favorites"
                          >
                            <Heart className="w-6 h-6 fill-current text-red-500" />
                          </button>
                        </div>

                        <h3 className="mt-2 text-2xl font-bold leading-tight text-white">
                          {trek.title}
                        </h3>

                        <div className="flex flex-wrap gap-4 mt-3 mb-4">
                          <div className="flex items-center gap-2 text-sm text-gray-300">
                            <MapPin className="w-4 h-4" />
                            <span>{trek.location}</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-gray-300">
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
                          className="inline-block rounded-full bg-blue-600 px-6 py-3 text-base font-bold text-white shadow-lg hover:bg-blue-500 transition-all hover:shadow-blue-500/50"
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
