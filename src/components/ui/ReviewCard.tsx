'use client';

import React from 'react';
import { Star } from 'lucide-react';

interface ReviewUser {
    full_name: string;
    avatar_url?: string;
}

interface Review {
    id: string;
    rating: number;
    comment: string;
    created_at: string;
    photo_urls?: string[];
    profiles?: ReviewUser; // Joined profile data
}

interface ReviewCardProps {
    review: Review;
    trekTitle?: string;
}

const ReviewCard: React.FC<ReviewCardProps> = ({ review, trekTitle }) => {
    const { rating, comment, created_at, photo_urls, profiles } = review;
    const userName = profiles?.full_name || 'Anonymous Trekker';
    const userAvatar = profiles?.avatar_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100'; // Default avatar
    const date = new Date(created_at).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });

    return (
        <div className="glass p-6 rounded-3xl space-y-4 hover:border-white/20 transition group">
            <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                    <img
                        src={userAvatar}
                        alt={userName}
                        className="w-10 h-10 rounded-full object-cover border border-white/10"
                    />
                    <div>
                        <p className="text-sm font-bold text-white">{userName}</p>
                        <p className="text-[10px] text-gray-500">{date}</p>
                    </div>
                </div>
                {trekTitle && (
                    <div className="bg-blue-500/10 border border-blue-500/30 px-3 py-1 rounded-full text-[10px] font-bold text-blue-400 uppercase">
                        {trekTitle}
                    </div>
                )}
            </div>

            <div className="flex text-yellow-400 scale-75 origin-left">
                {[...Array(5)].map((_, i) => (
                    <Star
                        key={i}
                        className={`w-4 h-4 ${i < rating ? 'fill-current' : 'text-gray-600'}`}
                    />
                ))}
            </div>

            <p className="text-sm text-gray-300 leading-relaxed">
                {comment}
            </p>

            {photo_urls && photo_urls.length > 0 && (
                <div className={`grid gap-2 h-24 ${photo_urls.length === 1 ? 'grid-cols-1' : photo_urls.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                    {photo_urls.slice(0, 3).map((url, index) => (
                        <img
                            key={index}
                            src={url}
                            alt={`Review photo ${index + 1}`}
                            className="w-full h-full object-cover rounded-xl border border-white/10"
                        />
                    ))}
                    {photo_urls.length > 3 && (
                        <div className="relative w-full h-full">
                            <img
                                src={photo_urls[2]}
                                alt="More photos"
                                className="w-full h-full object-cover rounded-xl border border-white/10 blur-[2px]"
                            />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-xl">
                                <span className="text-xs font-bold text-white">+{photo_urls.length - 2}</span>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default ReviewCard;
