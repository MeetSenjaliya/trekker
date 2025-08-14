// src/components/FavCard.tsx
'use client';

import React from 'react';
import Link from 'next/link';
import { Heart, Calendar, MapPin, Users } from 'lucide-react';

interface FavCardProps {
  id: string;
  title: string;
  location: string;
  date: string;
  coverImageUrl: string;
  difficulty: string;
  participantsCount: number;
}

const FavCard: React.FC<FavCardProps> = ({
  id,
  title,
  location,
  date,
  coverImageUrl,
  difficulty,
  participantsCount
}) => {
  return (
    <div className="bg-white rounded-xl shadow-md overflow-hidden hover:shadow-lg transition-shadow duration-200">
      <img
        src={coverImageUrl}
        alt={title}
        className="w-full h-48 object-cover"
      />

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
          <span className="text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded-full">
            {difficulty}
          </span>

          <div className="flex items-center text-gray-500 text-sm">
            <Users className="w-4 h-4 mr-1" />
            {participantsCount}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <Link
            href={`/treks/${id}`}
            className="text-blue-600 font-medium hover:underline"
          >
            View Details
          </Link>

          <Heart className="w-5 h-5 text-red-500" />
        </div>
      </div>
    </div>
  );
};

export default FavCard;
