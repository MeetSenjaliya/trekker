import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  getTrekDetail,
  getTrekReviews,
  getTrekParticipantCount,
  type TrekDetail,
  type TrekReview,
} from '@/lib/server-queries';
import { DEFAULT_TREK_IMAGE, siteUrl, truncate } from '@/lib/site';
import JsonLd from '@/components/ui/JsonLd';
import TrekDetailClient from './TrekDetailClient';

interface PageProps {
  params: Promise<{ id: string }>;
}

/** "Moderate · Uttarakhand · ₹4500" — the facts that make a shared link worth tapping. */
function factLine(trek: { difficulty?: string; location?: string; estimated_cost?: number }) {
  return [
    trek.difficulty ? `${trek.difficulty} trek` : null,
    trek.location,
    trek.estimated_cost != null ? `₹${trek.estimated_cost}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Structured data for the trek. A trek with departures is a series of Events —
 * Google wants one item per date rather than one Event with many — so scheduled
 * treks emit an Event per upcoming batch. A trek with no upcoming departure is
 * still a bookable thing but not an event, so it falls back to Product; that also
 * keeps evergreen treks eligible for a rich result instead of emitting nothing.
 */
function trekJsonLd(id: string, trek: TrekDetail, reviews: TrekReview[]) {
  const company = Array.isArray(trek.companies) ? trek.companies[0] : trek.companies;
  const name = trek.title ?? 'Trek';
  const url = `${siteUrl}/trek/${id}`;
  const image = trek.cover_image_url || DEFAULT_TREK_IMAGE;
  const description = truncate(trek.description?.trim() || factLine(trek), 300);

  const organizer = company
    ? { '@type': 'Organization', name: company.name, url: `${siteUrl}/company/${company.slug}` }
    : undefined;

  const offers =
    trek.estimated_cost != null
      ? {
          '@type': 'Offer',
          price: trek.estimated_cost,
          priceCurrency: 'INR',
          url,
          availability: 'https://schema.org/InStock',
        }
      : undefined;

  const aggregateRating = reviews.length
    ? {
        '@type': 'AggregateRating',
        ratingValue: (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1),
        reviewCount: reviews.length,
      }
    : undefined;

  // batch_date is a plain YYYY-MM-DD date, so lexical compare is date compare.
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (trek.trek_batches ?? [])
    .map((b) => b.batch_date)
    .filter((d) => d >= today)
    .sort();

  if (upcoming.length > 0) {
    return {
      '@context': 'https://schema.org',
      '@graph': upcoming.map((startDate) => ({
        '@type': 'Event',
        name,
        description,
        image,
        url,
        startDate,
        eventStatus: 'https://schema.org/EventScheduled',
        eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        location: {
          '@type': 'Place',
          name: trek.location || name,
          address: trek.meeting_point || trek.location || name,
        },
        ...(organizer && { organizer }),
        ...(offers && { offers }),
        ...(aggregateRating && { aggregateRating }),
        ...(trek.max_participants != null && { maximumAttendeeCapacity: trek.max_participants }),
      })),
    };
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    description,
    image,
    url,
    ...(organizer && { brand: organizer }),
    ...(offers && { offers }),
    ...(aggregateRating && { aggregateRating }),
  };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const trek = await getTrekDetail(id);

  if (!trek) {
    return { title: 'Trek not found', robots: { index: false, follow: false } };
  }

  const title = trek.title ?? 'Trek';
  const facts = factLine(trek);
  const body = trek.description?.trim();
  const description = truncate(body ? `${facts}. ${body}` : `${facts}. Book your spot with Trek Buddies.`);
  const image = trek.cover_image_url || DEFAULT_TREK_IMAGE;
  const url = `/trek/${id}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: 'article',
      images: [{ url: image, alt: title }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
    },
  };
}

export default async function TrekDetailPage({ params }: PageProps) {
  const { id } = await params;

  const trek = await getTrekDetail(id);
  if (!trek) notFound();

  // Only fired once the trek is known to exist, so a bad id costs one query.
  const [reviews, participantCount] = await Promise.all([
    getTrekReviews(id),
    getTrekParticipantCount(id),
  ]);

  return (
    <>
      <JsonLd data={trekJsonLd(id, trek, reviews)} />
      <TrekDetailClient
        id={id}
        trek={trek}
        reviews={reviews}
        initialParticipantCount={participantCount}
      />
    </>
  );
}
