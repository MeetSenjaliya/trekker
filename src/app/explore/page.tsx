import type { Metadata } from 'next';
import { DEFAULT_FILTERS } from '@/components/ui/FilterSection';
import { getDefaultExploreTreks } from '@/lib/server-queries';
import ExploreClient from './ExploreClient';

// Must match TREKS_PER_PAGE in ExploreClient — the server renders page 1 and the
// client adopts it as initialData, so a mismatch would show the wrong page size.
const TREKS_PER_PAGE = 6;

export const metadata: Metadata = {
  title: 'Explore Treks',
  description:
    'Browse upcoming treks by location, difficulty, distance, date and price. Book your next Himalayan or weekend trek with verified organizers.',
  alternates: { canonical: '/explore' },
  openGraph: {
    title: 'Explore Treks',
    description:
      'Browse upcoming treks by location, difficulty, distance, date and price. Book your next adventure with verified organizers.',
    url: '/explore',
    type: 'website',
  },
};

export default async function ExplorePage() {
  const initialData = await getDefaultExploreTreks(DEFAULT_FILTERS, TREKS_PER_PAGE);

  return <ExploreClient initialData={initialData} />;
}
