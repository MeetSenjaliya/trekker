'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import HeroSection from '@/components/ui/HeroSection';
import TrekCard from '@/components/ui/TrekCard';
import { supabase } from '@/lib/supabase';

const DEFAULT_IMAGE_URL = 'https://your-project.supabase.co/storage/v1/object/public/trek-profile/defaulttrek.jpeg';

interface Trek {
  id: string;
  title: string;
  description: string;
  cover_image_url: string;
  location: string;
  difficulty: 'Easy' | 'Moderate' | 'Hard' | 'Expert';
  current_participants: number;
  max_participants: number;
  rating: number;
  estimated_cost: number;
  trek_batches?: { batch_date: string }[];
}

export default function HomePage() {
  const [treks, setTreks] = useState<Trek[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTreks = async () => {
      const { data, error } = await supabase
        .from('treks')
        .select('*, trek_batches(batch_date)')
        .limit(3);

      if (error) {
        console.error('Error fetching treks:', error.message);
      } else {
        setTreks(data as Trek[]);
      }

      setLoading(false);
    };

    fetchTreks();
  }, []);

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <HeroSection />

      {/* Upcoming Treks Section */}
      <section className="py-16 md:py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12 md:mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">
              Upcoming Treks
            </h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">
              Discover your next adventure with our carefully curated selection of upcoming treks.
              From beginner-friendly trails to challenging expeditions.
            </p>
          </div>

          {loading ? (
            <p className="text-center text-slate-500 py-8">Loading treks...</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {treks.map((trek) => {
                // Find the earliest upcoming batch date
                const upcomingBatches = trek.trek_batches
                  ?.map(b => b.batch_date)
                  .sort()
                  .filter(d => new Date(d) >= new Date());

                const nextDate = upcomingBatches?.[0] || 'No upcoming dates';
                const dateDisplay = nextDate !== 'No upcoming dates'
                  ? new Date(nextDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                  : nextDate;

                return (
                  <TrekCard
                    key={trek.id}
                    id={trek.id}
                    title={trek.title}
                    description={trek.description}
                    image={trek.cover_image_url || DEFAULT_IMAGE_URL}
                    date={dateDisplay}
                    location={trek.location}
                    difficulty={trek.difficulty}
                    participants={{
                      current: trek.current_participants || 0,
                      max: trek.max_participants,
                    }}
                    rating={trek.rating}
                    price={trek.estimated_cost}
                  />
                );
              })}
            </div>
          )}

          <div className="text-center mt-12">
            <Link
              href="/explore"
              className="inline-flex items-center justify-center px-8 py-4 bg-blue-500 hover:bg-blue-600 text-white text-base font-semibold rounded-lg shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200"
            >
              View All Treks
            </Link>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-16 md:py-24 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">
              Why Choose Trek Buddies?
            </h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">
              We make trekking accessible, safe, and unforgettable for adventurers of all levels.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="text-center p-6">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-slate-900 mb-2">Expert Guides</h3>
              <p className="text-slate-600">
                Our experienced guides ensure your safety while sharing their deep knowledge of local terrain and culture.
              </p>
            </div>

            <div className="text-center p-6">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-slate-900 mb-2">Safety First</h3>
              <p className="text-slate-600">
                We prioritize your safety with comprehensive planning, quality equipment, and emergency protocols.
              </p>
            </div>

            <div className="text-center p-6">
              <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-slate-900 mb-2">Community</h3>
              <p className="text-slate-600">
                Join a vibrant community of like-minded adventurers and forge lifelong friendships on the trail.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}