'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Calendar, MapPin, Users, Star, ArrowRight } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import { joinTrekBatchAndChat } from '@/lib/joinTrek';
import ConfirmationModal from './ConfirmationModal';

interface TrekCardProps {
  id: string;
  title: string;
  description: string;
  image: string;
  date: string;
  location: string;

  difficulty: 'Easy' | 'Moderate' | 'Hard' | 'Expert';
  participants: {
    current: number;
    max: number;
  };
  rating?: number;
  price?: number;
  organizer?: {
    name: string;
    avatar: string;
  };
  whatsappGroupLink?: string;
  next_batch_date?: string; // ISO date string for next upcoming batch
}

const TrekCard: React.FC<TrekCardProps> = ({
  id,
  title,
  description,
  image,
  date,
  location,
  difficulty,
  participants,
  rating,
  price,
  organizer,
  whatsappGroupLink,
  next_batch_date,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserId(user.id);
      }
    };
    getUser();
  }, [supabase]);

  const getDifficultyColor = (level: string) => {
    switch (level) {
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

  const isFull = participants.current >= participants.max;

  const handleJoinTrek = async () => {
    // Re-check authentication at click time
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      alert('Please log in to join this trek.');
      router.push('/login'); // Redirect to login page
      return;
    }

    if (isFull) {
      return;
    }

    // Check if next_batch_date exists
    if (!next_batch_date || next_batch_date === 'No upcoming dates') {
      alert('No upcoming batch dates available for this trek.');
      return;
    }

    setJoining(true);

    try {
      // Call shared join function with next batch date
      const result = await joinTrekBatchAndChat({
        userId: user.id,
        trekId: id,
        trekTitle: title,
        date: next_batch_date
      });

      // Show result message
      alert(result.message);

      if (result.success && result.conversationId) {
        // Redirect to chat
        router.push(`/messages?conversationId=${result.conversationId}`);
      }
    } finally {
      setJoining(false);
    }
  };

  // Keep modal-based join for compatibility (if needed in future)
  const handleConfirmJoin = async (date: string) => {
    if (!userId) {
      alert('Please log in to join this trek.');
      return;
    }

    const result = await joinTrekBatchAndChat({
      userId,
      trekId: id,
      trekTitle: title,
      date
    });

    alert(result.message);

    if (result.success) {
      setIsModalOpen(false);

      if (result.conversationId) {
        router.push(`/messages?conversationId=${result.conversationId}`);
      }
    }
  };



  return (
    <div className="bg-white rounded-xl shadow-lg overflow-hidden transition-all duration-300 hover:shadow-2xl group">
      {/* Image Section */}
      <div className="relative h-48 sm:h-56 overflow-hidden">
        <img
          src={image}
          alt={title}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
        />

        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

        {/* Date overlay */}
        <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-sm rounded-lg px-3 py-1">
          <p className="text-xs font-medium text-slate-800 flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {date}
          </p>
        </div>

        {/* Price overlay */}
        {/* {price && (
          <div className="absolute top-4 right-4 bg-blue-500 text-white rounded-lg px-3 py-1">
            <p className="text-sm font-semibold">${price}</p>
          </div>
        )} */}

        {/* Rating overlay */}
        {rating && (
          <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-sm rounded-lg px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <div className="flex items-center gap-1">
              <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
              <span className="text-xs font-medium text-slate-800">{rating}</span>
            </div>
          </div>
        )}
      </div>

      {/* Content Section */}
      <div className="p-6">
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-xl font-semibold text-slate-900 leading-tight group-hover:text-blue-600 transition-colors">
            {title}
          </h3>
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getDifficultyColor(difficulty)}`}>
            {difficulty}
          </span>
        </div>

        <div className="space-y-2 mb-4">
          <div className="flex items-center text-sm text-slate-600">
            <MapPin className="w-4 h-4 mr-2 text-slate-400" />
            {location}
          </div>
          <div className="flex items-center text-sm text-slate-600">
            <Users className="w-4 h-4 mr-2 text-slate-400" />
            {participants.current}/{participants.max} joined
            {isFull && <span className="ml-2 text-red-600 font-medium">(Full)</span>}
          </div>
        </div>

        <p className="text-slate-700 text-sm leading-relaxed mb-4 line-clamp-3">
          {description}
        </p>

        {/* Organizer */}
        {/* {organizer && (
          <div className="flex items-center mb-4 p-3 bg-slate-50 rounded-lg">
            <img
              src={organizer.avatar}
              alt={organizer.name}
              className="w-8 h-8 rounded-full mr-3"
            />
            <div>
              <p className="text-sm font-medium text-slate-900">Organized by</p>
              <p className="text-xs text-slate-600">{organizer.name}</p>
            </div>
          </div>
        )} */}

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleJoinTrek}
            disabled={isFull || joining}
            className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-semibold transition-colors ${isFull || joining
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-blue-500 hover:bg-blue-600 text-white shadow-md hover:shadow-lg'
              }`}
          >
            {joining ? 'Joining...' : isFull ? 'Full' : 'Join Trek'}
          </button>

          <Link
            href={`/trek/${id}`}
            className="flex-1 py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-lg transition-colors text-center"
          >
            View Details
          </Link>


        </div>

        {/* Learn More Link */}
        <Link
          href={`/trek/${id}`}
          className="inline-flex items-center text-blue-500 hover:text-blue-600 font-semibold text-sm mt-4 group/link"
        >
          Learn More
          <ArrowRight className="ml-1.5 w-4 h-4 transition-transform duration-200 group-hover/link:translate-x-1" />
        </Link>
      </div>

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onConfirm={handleConfirmJoin}
        trekTitle={title}
      />
    </div>
  );
};

export default TrekCard;

