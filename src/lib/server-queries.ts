import { cache } from 'react';
import { createClient } from '@/utils/supabase/server';
import type { SearchTrek } from '@/lib/queries';
import type { FilterState } from '@/components/ui/FilterSection';

// Server-side reads for the pages that must ship real HTML (SEO) plus the
// sitemap. These mirror the TanStack hooks in `@/lib/queries`, but run through
// the `utils/supabase/server` factory so they see the request's auth cookie and
// get the same RLS view the client would — a company member previewing their
// own inactive trek still sees it.
//
// Each `get*` is wrapped in React `cache()` so `generateMetadata()` and the page
// body share one round-trip per request.

export interface TrekBatch {
  batch_date: string;
}

export interface TrekCompany {
  name: string;
  slug: string;
}

export interface TrekReview {
  id: string;
  rating: number;
  comment: string;
  created_at: string;
  photo_urls?: string[];
  profiles?: { full_name: string; avatar_url?: string };
}

export interface TrekDetail {
  id: string;
  cover_image_url?: string;
  description?: string;
  difficulty?: string;
  distance_km?: number;
  duration_hours?: number;
  estimated_cost?: number;
  gear_checklist?: string[];
  location?: string;
  max_participants?: number;
  meeting_point?: string;
  meeting_point2?: string;
  plan?: string;
  rating?: number;
  title?: string;
  trek_batches?: TrekBatch[];
  companies?: TrekCompany | TrekCompany[] | null;
}

export interface CompanyProfile {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  website: string | null;
  status: string;
}

/** Trek detail row with embedded batches + company. Null when not found/visible. */
export const getTrekDetail = cache(async (id: string): Promise<TrekDetail | null> => {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('treks')
    .select('*, trek_batches(batch_date), companies(name, slug)')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('Error fetching trek:', error.message);
    return null;
  }
  return (data as TrekDetail | null) ?? null;
});

/** A trek's reviews, newest first. Reviewer identity comes from public_profiles (non-PII). */
export const getTrekReviews = cache(async (id: string): Promise<TrekReview[]> => {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('trek_reviews')
    .select('*, profiles:public_profiles(full_name, avatar_url)')
    .eq('trek_id', id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching reviews:', error.message);
    return [];
  }
  return (data as TrekReview[]) ?? [];
});

/** Confirmed participants across every batch of a trek. 0 on error. */
export const getTrekParticipantCount = cache(async (id: string): Promise<number> => {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('get_trek_participant_count', { trek_uuid: id });
  if (error) {
    console.error('Error fetching participant count:', error.message);
    return 0;
  }
  return typeof data === 'number' ? data : 0;
});

/** Public company profile by slug. Null when not found or not visible under RLS. */
export const getCompanyBySlug = cache(async (slug: string): Promise<CompanyProfile | null> => {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('companies')
    .select('id, name, slug, description, logo_url, cover_image_url, website, status')
    .eq('slug', slug)
    .maybeSingle();

  if (error) {
    console.error('Error loading company:', error.message);
    return null;
  }
  return (data as CompanyProfile | null) ?? null;
});

/** A company's public treks for its storefront. */
export const getStorefrontTreks = cache(async (companyId: string): Promise<SearchTrek[]> => {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('search_treks', {
    p_search: null,
    p_location: null,
    p_difficulty: null,
    p_min_distance: null,
    p_max_distance: null,
    p_min_price: null,
    p_max_price: null,
    p_date_from: null,
    p_sort: 'date',
    p_limit: 100,
    p_offset: 0,
    p_company_id: companyId,
  });

  if (error) {
    console.error('Error loading storefront treks:', error.message);
    return [];
  }
  return (data ?? []) as SearchTrek[];
});

/**
 * Featured treks for the home page. One RPC instead of N+1: search_treks
 * already returns the avg rating, the confirmed-only participants_joined
 * counter and the next batch date.
 */
export const getFeaturedTreks = cache(async (limit = 3): Promise<SearchTrek[]> => {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('search_treks', {
    p_search: null,
    p_location: null,
    p_difficulty: null,
    p_min_distance: null,
    p_max_distance: null,
    p_min_price: null,
    p_max_price: null,
    p_date_from: null,
    p_sort: 'date',
    p_limit: limit,
    p_offset: 0,
  });

  if (error) {
    console.error('Error loading featured treks:', error.message);
    return [];
  }
  return (data ?? []) as SearchTrek[];
});

/**
 * First page of Explore under the default filters, so the initial HTML carries
 * real trek content. The client takes over from here for filtering/paging.
 */
export const getDefaultExploreTreks = cache(
  async (filters: FilterState, perPage: number): Promise<{ treks: SearchTrek[]; totalCount: number }> => {
    const supabase = await createClient();

    const { data, error } = await supabase.rpc('search_treks', {
      p_search: null,
      p_location: null,
      p_difficulty: null,
      p_min_distance: null,
      p_max_distance: null,
      p_min_price: null,
      p_max_price: null,
      p_date_from: null,
      p_sort: filters.sort || 'date',
      p_limit: perPage,
      p_offset: 0,
    });

    if (error) {
      console.error('Error loading explore treks:', error.message);
      return { treks: [], totalCount: 0 };
    }

    const rows = (data ?? []) as SearchTrek[];
    return { treks: rows, totalCount: rows[0]?.total_count ?? 0 };
  }
);

// ---- Sitemap ---------------------------------------------------------------
// Filtered explicitly rather than leaning on RLS: a signed-in platform admin
// requesting /sitemap.xml would otherwise get every pending company back.

export async function getIndexableTrekIds(): Promise<string[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('treks')
    .select('id, companies!inner(status)')
    .eq('is_active', true)
    .eq('companies.status', 'approved');

  if (error) {
    console.error('Error loading sitemap treks:', error.message);
    return [];
  }
  return ((data ?? []) as { id: string }[]).map((t) => t.id);
}

export async function getIndexableCompanies(): Promise<{ slug: string; created_at: string }[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('companies')
    .select('slug, created_at')
    .eq('status', 'approved');

  if (error) {
    console.error('Error loading sitemap companies:', error.message);
    return [];
  }
  return (data ?? []) as { slug: string; created_at: string }[];
}
