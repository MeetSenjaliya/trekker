'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Heart, Calendar, MapPin, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext'; // Assuming you have an AuthContext to get user ID

interface FavCardProps {
  id: string;
  title: string;
  location: string;
  date: string;
  coverImageUrl: string;
  difficulty: string;
  participantsCount: number;
}

const getDifficultyColor = (level: string) => {
  switch (level) {
    case 'Easy':
      return 'bg-green-100 text-green-800';
    case 'Moderate':
      return 'bg-purple-100 text-purple-800';
    case 'Hard':
      return 'bg-red-100 text-red-800';
    case 'Expert':
      return 'bg-black text-white';
    default:
      return 'bg-gray-100 text-gray-800';
  }
};

const FavCard: React.FC<FavCardProps> = ({
  id,
  title,
  location,
  date,
  coverImageUrl,
  difficulty,
  participantsCount,
}) => {
  const { user } = useAuth(); // Get user from AuthContext
  const [isLiked, setIsLiked] = useState(false);
  const userId = user?.id || null; // Get user ID from AuthContext

  // Check if the trek is already favorited when component mounts
  useEffect(() => {
    const checkFavorite = async () => {
      if (!userId) return;

      try {
        const { data, error } = await supabase
          .from('favorites')
          .select('*')
          .eq('user_id', userId)
          .eq('trek_id', id);

        if (error) {
          console.error('Error checking favorite:', error);
          return;
        }

        setIsLiked(!!data?.length); // Set isLiked to true if favorite exists
      } catch (err) {
        console.error('Unexpected error checking favorite:', err);
      }
    };

    checkFavorite();
  }, [userId, id]);

  const toggleFavorite = async () => {
    if (!userId) {
      alert('Please log in to favorite this trek.');
      return;
    }

    try {
      if (isLiked) {
        const { error } = await supabase
          .from('favorites')
          .delete()
          .eq('user_id', userId)
          .eq('trek_id', id);

        if (error) {
          console.error('Error removing favorite:', error);
          alert('Failed to remove favorite.');
          return;
        }

        setIsLiked(false);
      } else {
        const { error } = await supabase
          .from('favorites')
          .insert([{ user_id: userId, trek_id: id }]);

        if (error) {
          console.error('Error adding favorite:', error);
          alert('Failed to add favorite.');
          return;
        }

        setIsLiked(true);
      }
    } catch (err) {
      console.error('Unexpected error toggling favorite:', err);
      alert('An unexpected error occurred.');
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-md overflow-hidden hover:shadow-lg transition-shadow duration-200">
      <img src={coverImageUrl} alt={title} className="w-full h-48 object-cover" />

      <div className="p-4">
        <h3 className="text-lg font-semibold text-gray-800">{title}</h3>

        <div className="flex items-center text-gray-500 text-sm mt-1">
          <MapPin className="w-4 h-4 mr-1" />
          {location}
        </div>

        <div className="flex items-center text-gray-500 text-sm mt-1">
          <Calendar className="w-4 h-4 mr-1" />
          {new Date(date).toLocaleDateString()}
        </div>

        <div className="flex items-center justify-between mt-3">
          <span className={`text-xs px-2 py-1 rounded-full ${getDifficultyColor(difficulty)}`}>
            {difficulty}
          </span>

          <div className="flex items-center text-gray-500 text-sm">
            <Users className="w-4 h-4 mr-1" />
            {participantsCount}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <Link
            href={`/trek/${id}`}
            className="text-blue-600 font-medium hover:underline"
          >
            View Details
          </Link>

          <button
            onClick={toggleFavorite}
            className={`p-2 rounded-full transition-colors ${
              isLiked ? 'bg-red-500 text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
            }`}
          >
            <Heart className={`w-5 h-5 ${isLiked ? 'fill-current' : ''}`} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default FavCard;