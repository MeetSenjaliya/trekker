import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  getTrekDetail,
  getTrekReviews,
  getTrekParticipantCount,
} from '@/lib/server-queries';
import { DEFAULT_TREK_IMAGE, truncate } from '@/lib/site';
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
    <TrekDetailClient
      id={id}
      trek={trek}
      reviews={reviews}
      initialParticipantCount={participantCount}
    />
  );
}
