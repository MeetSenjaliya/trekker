import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { BadgeCheck, Globe, MapPin } from 'lucide-react';
import TrekCard from '@/components/ui/TrekCard';
import { getCompanyBySlug, getStorefrontTreks } from '@/lib/server-queries';
import { DEFAULT_TREK_IMAGE, truncate } from '@/lib/site';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const company = await getCompanyBySlug(slug);

  if (!company) {
    return { title: 'Company not found', robots: { index: false, follow: false } };
  }

  const title = company.name;
  const description = truncate(
    company.description?.trim() || `Browse treks organized by ${company.name} on Trek Buddies.`
  );
  const image = company.cover_image_url || company.logo_url || DEFAULT_TREK_IMAGE;
  const url = `/company/${slug}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    // Unapproved companies stay reachable for their own members but must never
    // be indexed.
    robots: company.status === 'approved' ? undefined : { index: false, follow: false },
    openGraph: {
      title,
      description,
      url,
      type: 'profile',
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

export default async function CompanyStorefrontPage({ params }: PageProps) {
  const { slug } = await params;

  const company = await getCompanyBySlug(slug);
  if (!company) notFound();

  const treks = await getStorefrontTreks(company.id);
  const isVerified = company.status === 'approved';

  return (
    <div className="min-h-screen bg-[#090a0f] text-slate-200 overflow-x-hidden">
      {/* Cover */}
      <section className="relative h-[45vh] w-full overflow-hidden">
        <Image
          src={company.cover_image_url || DEFAULT_TREK_IMAGE}
          alt={company.name}
          fill
          priority
          className="object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#090a0f] via-[#090a0f]/40 to-black/20" />
      </section>

      <main className="max-w-7xl mx-auto px-6 lg:px-12 relative z-10">
        {/* Header: logo + name */}
        <div className="-mt-20 flex flex-col sm:flex-row sm:items-end gap-6">
          <div className="w-32 h-32 rounded-3xl overflow-hidden border border-white/10 bg-white/5 backdrop-blur-md shrink-0 shadow-2xl">
            {company.logo_url ? (
              <Image
                src={company.logo_url}
                alt={`${company.name} logo`}
                width={128}
                height={128}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-4xl font-black text-white/40">
                {company.name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>

          <div className="pb-2">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight">
                {company.name}
              </h1>
              {isVerified && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/15 border border-blue-500/40 text-blue-300 text-xs font-bold uppercase tracking-wider">
                  <BadgeCheck className="w-4 h-4" /> Verified
                </span>
              )}
            </div>
            {company.website && (
              <a
                href={company.website}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
              >
                <Globe className="w-4 h-4" />
                {company.website.replace(/^https?:\/\//, '')}
              </a>
            )}
          </div>
        </div>

        {/* Description */}
        {company.description && (
          <p className="mt-8 max-w-3xl text-lg text-slate-400 leading-relaxed font-light">
            {company.description}
          </p>
        )}

        {/* Treks */}
        <section className="mt-14 pb-20">
          <h2 className="text-2xl font-bold text-white flex items-center gap-3 mb-8">
            <span className="w-1.5 h-8 bg-blue-500 rounded-full inline-block" />
            Treks by {company.name}
          </h2>

          {treks.length === 0 ? (
            <div className="text-center py-16 bg-white/[0.02] rounded-3xl border-2 border-dashed border-white/5">
              <MapPin className="w-8 h-8 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-500 font-medium">
                This company hasn&apos;t published any treks yet.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
              {treks.map((trek) => {
                const nextDate = trek.next_batch_date || undefined;
                const dateDisplay = nextDate
                  ? new Date(nextDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                  : 'No upcoming dates';

                return (
                  <TrekCard
                    key={trek.id}
                    id={String(trek.id)}
                    title={trek.title}
                    description={trek.description}
                    image={trek.cover_image_url || DEFAULT_TREK_IMAGE}
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
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
