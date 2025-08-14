'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import TrekCard from '@/components/ui/TrekCard';
import FilterSection from '@/components/ui/FilterSection';
import TrekPagination from '@/components/ui/TrekPagination';

const DEFAULT_IMAGE_URL =
  'https://dtjmyqogeozrzzbdjokr.supabase.co/storage/v1/object/public/trek-profile/defaulttrek.jpeg';

type Trek = {
  id: string | number;
  title: string;
  description: string;
  cover_image_url?: string;
  date: string;
  location: string;
  difficulty: string;
  participants_joined?: number; 
  max_participants?: number;
  rating?: number;
  estimated_cost?: number;
};

export default function ExplorePage() {
  const [treks, setTreks] = useState<Trek[]>([]);
  const [loading, setLoading] = useState(true);
  type Filters = {
    search?: string;
    location?: string;
    date?: string;
    difficulty?: string;
    minParticipants?: string;
  };

  const [filters, setFilters] = useState<Filters>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const TREKS_PER_PAGE = 6;

  const fetchTreks = async (filterValues: Filters = {}, page = 1) => {
    let query = supabase.from('treks').select('*', { count: 'exact' });

    if (filterValues.search) {
      query = query.ilike('title', `%${filterValues.search}%`);
    }
    if (filterValues.location) {
      query = query.ilike('location', `%${filterValues.location}%`);
    }
    if (filterValues.date) {
      query = query.gte('date', filterValues.date);
    }
    if (filterValues.difficulty) {
      query = query.eq('difficulty', filterValues.difficulty);
    }
    if (filterValues.minParticipants) {
      query = query.gte('participants_joined', parseInt(filterValues.minParticipants));
    }

    const from = (page - 1) * TREKS_PER_PAGE;
    const to = from + TREKS_PER_PAGE - 1;

    const { data, count, error } = await query.range(from, to).order('date', { ascending: true });

    if (error) {
      console.error('Error fetching treks:', error.message);
    } else {
      setTreks(data);
      setTotalPages(Math.ceil((count || 0) / TREKS_PER_PAGE));
      setTotalCount(count || 0);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchTreks(filters, currentPage);
  }, [filters, currentPage]);

  const startIdx = (currentPage - 1) * TREKS_PER_PAGE + 1;
  const endIdx = Math.min(currentPage * TREKS_PER_PAGE, totalCount);

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Page Header */}
        <div className="mb-8 text-center sm:text-left">
          <h1 className="text-4xl font-bold text-slate-900 tracking-tight mb-2">
            Explore Treks
          </h1>
          <p className="text-lg text-slate-600">
            Find your next adventure with our curated list of treks around the world.
          </p>
        </div>

        {/* Filter Section */}
        <FilterSection onFilterChange={(f) => { setCurrentPage(1); setFilters(f); }} />

        {/* Results Summary */}
        <div className="mb-6">
          <p className="text-slate-600">
            Showing <span className="font-semibold">{startIdx}–{endIdx}</span> of <span className="font-semibold">{totalCount}</span> treks
          </p>
        </div>

        {/* Trek Grid */}
        {loading ? (
          <p className="text-center py-10 text-gray-500">Loading treks...</p>
        ) : treks.length === 0 ? (
          <p className="text-center py-10 text-gray-500">No treks found matching your filters.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
            {treks.map((trek) => (
              <TrekCard
                key={trek.id}
                id={String(trek.id)}
                title={trek.title}
                description={trek.description}
                image={trek.cover_image_url || DEFAULT_IMAGE_URL}
                date={new Date(trek.date).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
                location={trek.location}
                difficulty={trek.difficulty as 'Easy' | 'Moderate' | 'Hard' | 'Expert'}
                participants={{
                  current: trek.participants_joined || 0,
                  max: trek.max_participants ?? 0,
                }}
                rating={trek.rating}
                price={trek.estimated_cost}
              />
            ))}
          </div>
        )}

        {!loading && totalPages > 1 && (
          <TrekPagination
            totalPages={totalPages}
            currentPage={currentPage}
            onPageChange={(page) => setCurrentPage(page)}
          />
        )}

        {/* Call to Action */}
        <div className="mt-16 bg-blue-50 rounded-2xl p-8 text-center">
          <h2 className="text-2xl font-bold text-slate-900 mb-4">
            Can't find the perfect trek?
          </h2>
          <p className="text-slate-600 mb-6 max-w-2xl mx-auto">
            Create your own trek and invite fellow adventurers to join you on a custom expedition 
            tailored to your preferences and schedule.
          </p>
          <button className="inline-flex items-center justify-center px-8 py-3 bg-blue-500 hover:bg-blue-600 text-white text-base font-semibold rounded-lg shadow-md hover:shadow-lg transition-all duration-200">
            Create Your Own Trek
          </button>
        </div>
      </div>
    </div>
  );
}
