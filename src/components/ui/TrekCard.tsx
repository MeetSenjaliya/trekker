'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Calendar, MapPin, Users, Star, ArrowRight } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import { joinTrekBatchAndChat } from '@/lib/joinTrek';
import ConfirmationModal from './ConfirmationModal';
import { getDisplayParticipantCount } from '@/lib/utils';

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
  next_batch_date?: string; 
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

  // Updated Colors for Dark Mode (Translucent/Glassy look)
  const getDifficultyColor = (level: string) => {
    switch (level) {
      case 'Easy':
        return 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
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

  const isFull = participants.current >= participants.max;

  const handleJoinTrek = async () => {
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      alert('Please log in to join this trek.');
      router.push('/login'); 
      return;
    }

    if (isFull) {
      return;
    }

    if (!next_batch_date || next_batch_date === 'No upcoming dates') {
      alert('No upcoming batch dates available for this trek.');
      return;
    }

    setJoining(true);

    try {
      const result = await joinTrekBatchAndChat({
        userId: user.id,
        trekId: id,
        trekTitle: title,
        date: next_batch_date
      });

      alert(result.message);

      if (result.success && result.conversationId) {
        router.push(`/messages?conversationId=${result.conversationId}`);
      }
    } finally {
      setJoining(false);
    }
  };

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
    // Changed: bg-white -> bg-white/5 backdrop-blur-md (Glassmorphism)
    // Added border-white/10 for subtle edge definition
    <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl overflow-hidden transition-all duration-300 hover:shadow-[0_0_30px_rgba(0,0,0,0.5)] group h-full flex flex-col">
      
      {/* Image Section */}
      <div className="relative h-52 sm:h-60 overflow-hidden">
        <img
          src={image}
          alt={title}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
        />

        {/* Dark gradient overlay for text readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0f172a] via-transparent to-transparent opacity-80" />

        {/* Date overlay - Darker glass style */}
        <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md border border-white/10 rounded-lg px-3 py-1.5 shadow-lg">
          <p className="text-xs font-semibold text-white flex items-center gap-1.5 tracking-wide">
            <Calendar className="w-3 h-3 text-blue-400" />
            {date}
          </p>
        </div>

        {/* Rating overlay */}
        {rating && (
          <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-md border border-white/10 rounded-lg px-2.5 py-1 transition-opacity duration-300">
            <div className="flex items-center gap-1.5">
              <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
              <span className="text-xs font-bold text-white">{rating}</span>
            </div>
          </div>
        )}
      </div>

      {/* Content Section */}
      <div className="p-6 flex flex-col flex-grow">
        <div className="flex items-start justify-between mb-4">
          {/* Title Color: White */}
          <h3 className="text-xl font-bold text-white leading-tight group-hover:text-blue-400 transition-colors">
            {title}
          </h3>
          {/* Difficulty Badge */}
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${getDifficultyColor(difficulty)}`}>
            {difficulty}
          </span>
        </div>

        <div className="space-y-3 mb-5">
          <div className="flex items-center text-sm text-gray-300">
            <MapPin className="w-4 h-4 mr-2.5 text-blue-400" />
            {location}
          </div>
          <div className="flex items-center text-sm text-gray-300">
            <Users className="w-4 h-4 mr-2.5 text-blue-400" />
            {getDisplayParticipantCount(participants.current)}/{participants.max} joined
            {isFull && <span className="ml-2 text-red-400 font-bold tracking-wide text-xs uppercase">(Full)</span>}
          </div>
        </div>

        {/* Description: Light Gray text */}
        <p className="text-gray-400 text-sm leading-relaxed mb-6 line-clamp-2">
          {description}
        </p>

        {/* Action Buttons */}
        <div className="mt-auto grid grid-cols-2 gap-3">
          <button
            onClick={handleJoinTrek}
            disabled={isFull || joining}
            className={`py-2.5 px-4 rounded-lg text-sm font-semibold transition-all duration-200 
              ${isFull || joining
              ? 'bg-gray-700 text-gray-400 cursor-not-allowed border border-gray-600'
              : 'bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_15px_rgba(37,99,235,0.4)] hover:shadow-[0_0_20px_rgba(37,99,235,0.6)] border border-transparent'
              }`}
          >
            {joining ? 'Joining...' : isFull ? 'Full' : 'Join Now'}
          </button>

          {/* View Details: Transparent Glass Button */}
          <Link
            href={`/trek/${id}`}
            className="py-2.5 px-4 bg-white/5 hover:bg-white/10 text-white border border-white/10 text-sm font-semibold rounded-lg transition-all duration-200 text-center flex items-center justify-center gap-2 group/btn"
          >
            Details
            <ArrowRight className="w-4 h-4 text-gray-400 group-hover/btn:text-white transition-colors" />
          </Link>
        </div>
      </div>

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