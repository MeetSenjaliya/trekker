'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import TrekCard from '@/components/ui/TrekCard';
import FilterSection, { DEFAULT_FILTERS, type FilterState } from '@/components/ui/FilterSection';
import TrekPagination from '@/components/ui/TrekPagination';
import SnowEffect from '@/components/ui/SnowEffect';

const DEFAULT_IMAGE_URL =
  'https://dtjmyqogeozrzzbdjokr.supabase.co/storage/v1/object/public/trek-profile/defaulttrek.jpeg';

type Trek = {
  id: string;
  title: string;
  description: string;
  cover_image_url?: string;
  location: string;
  difficulty: string;
  distance_km?: number;
  max_participants?: number;
  rating?: number;
  estimated_cost?: number;
  participants_joined?: number;
  next_batch_date?: string | null;
  total_count?: number;
};

const num = (v: string) => (v.trim() === '' ? null : Number(v));

export default function ExplorePage() {
  const [treks, setTreks] = useState<Trek[]>([]);
  const [loading, setLoading] = useState(true);

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const TREKS_PER_PAGE = 6;

  const fetchTreks = async (f: FilterState, page: number) => {
    const { data, error } = await supabase.rpc('search_treks', {
      p_search: f.search.trim() || null,
      p_location: f.location || null,
      p_difficulty: f.difficulty || null,
      p_min_distance: num(f.minDistance),
      p_max_distance: num(f.maxDistance),
      p_min_price: num(f.minPrice),
      p_max_price: num(f.maxPrice),
      p_date_from: f.date || null,
      p_sort: f.sort || 'date',
      p_limit: TREKS_PER_PAGE,
      p_offset: (page - 1) * TREKS_PER_PAGE,
    });

    if (error) {
      console.error('Error fetching treks:', error.message);
      setTreks([]);
      setTotalPages(1);
      setTotalCount(0);
    } else {
      const rows = (data || []) as Trek[];
      const count = rows[0]?.total_count ?? 0;
      setTreks(rows);
      setTotalPages(Math.max(1, Math.ceil(count / TREKS_PER_PAGE)));
      setTotalCount(count);
    }

    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      fetchTreks(filters, currentPage);
    }, 300);
    return () => clearTimeout(t);
  }, [filters, currentPage]);

  const startIdx = (currentPage - 1) * TREKS_PER_PAGE + 1;
  const endIdx = Math.min(currentPage * TREKS_PER_PAGE, totalCount);

  return (
    // Main Container with Night Gradient
    <div className="min-h-screen py-12 pt-24 relative overflow-hidden" style={{ background: 'linear-gradient(to bottom, #1b2735 0%, #090a0f 100%)' }}>

      {/* Snow Effect Component */}
      <SnowEffect />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Page Header */}
        <div className="mb-10 text-center sm:text-left">
          <h1 className="text-5xl font-extralight text-white tracking-wide mb-3 drop-shadow-md">
            Explore Treks
          </h1>
          <p className="text-lg text-blue-100/80 font-light">
            Find your next adventure with our curated list of treks around the world.
          </p>
        </div>

        {/* Filter Section */}
        {/* Note: Ensure your FilterSection component supports dark mode or is transparent */}
        <div className="mb-8">
          <FilterSection onFilterChange={(f) => { setCurrentPage(1); setFilters(f); }} />
          {/* setCurrentPage on every filter change avoids landing on an out-of-range page */}
        </div>

        {/* Results Summary */}
        <div className="mb-6 flex items-center justify-between">
          <p className="text-blue-200/70 text-sm tracking-wider uppercase">
            Showing <span className="font-bold text-white">{totalCount > 0 ? startIdx : 0}–{endIdx}</span> of <span className="font-bold text-white">{totalCount}</span> treks
          </p>
        </div>

        {/* Trek Grid */}
        {loading ? (
          <div className="min-h-[400px] flex items-center justify-center">
            <p className="text-white/60 animate-pulse text-xl">Loading adventures...</p>
          </div>
        ) : treks.length === 0 ? (
          <div className="text-center py-20 bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10">
            <p className="text-xl text-gray-300">No treks found matching your filters.</p>
            <button
              onClick={() => { setCurrentPage(1); setFilters(DEFAULT_FILTERS); }}
              className="mt-4 text-blue-400 hover:text-blue-300 underline underline-offset-4"
            >
              Clear all filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 mb-16">
            {treks.map((trek) => {
              const nextDate = trek.next_batch_date || undefined;
              const dateDisplay = nextDate
                ? new Date(nextDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                : 'No upcoming dates';

              return (
                <div key={trek.id} className="transform hover:scale-[1.02] transition-transform duration-300">
                  <TrekCard
                    id={String(trek.id)}
                    title={trek.title}
                    description={trek.description}
                    image={trek.cover_image_url || DEFAULT_IMAGE_URL}
                    date={dateDisplay}
                    location={trek.location}
                    difficulty={trek.difficulty as 'Easy' | 'Moderate' | 'Hard' | 'Expert'}
                    participants={{
                      current: trek.participants_joined ?? 0,
                      max: trek.max_participants ?? 0,
                    }}
                    rating={trek.rating != null ? Number(trek.rating) : undefined}
                    price={trek.estimated_cost}
                    next_batch_date={nextDate}
                  />
                </div>
              );
            })}
          </div>
        )}

        {!loading && totalPages > 1 && (
          <div className="flex justify-center mt-8">
            <TrekPagination
              totalPages={totalPages}
              currentPage={currentPage}
              onPageChange={(page) => setCurrentPage(page)}
            />
          </div>
        )}

        {/* Call to Action - UPDATED: Glassmorphism Style */}
        <div className="mt-20 relative overflow-hidden rounded-3xl border border-white/10 p-10 text-center shadow-2xl">
          {/* Glass Background Layer */}
          <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-md" />

          {/* Content Layer */}
          <div className="relative z-10">
            <h2 className="text-3xl font-light text-white mb-4 tracking-wide">
              Can&apos;t find the perfect trek?
            </h2>
            <p className="text-blue-100/70 mb-8 max-w-2xl mx-auto text-lg leading-relaxed">
              Create your own trek and invite fellow adventurers to join you on a custom expedition
              tailored to your preferences and schedule.
            </p>
            <button className="inline-flex items-center justify-center px-8 py-4 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-medium rounded-full shadow-[0_0_20px_rgba(59,130,246,0.5)] hover:shadow-[0_0_30px_rgba(59,130,246,0.7)] transition-all duration-300 transform hover:-translate-y-1">
              Create Your Own Trek
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}