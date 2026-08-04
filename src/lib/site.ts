/**
 * Absolute origin for this deployment. Server-only — `VERCEL_PROJECT_PRODUCTION_URL`
 * is not exposed to the browser, so never import this from a client component.
 *
 * Needed because OG/Twitter image URLs and sitemap entries must be absolute:
 * scrapers resolve them against nothing, so a relative `/foo.jpg` silently
 * yields no preview image in production.
 */
export const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'http://localhost:3000')
).replace(/\/$/, '');

export const SITE_NAME = 'Trek Buddies';

export const DEFAULT_TREK_IMAGE =
  'https://dtjmyqogeozrzzbdjokr.supabase.co/storage/v1/object/public/trek-profile/defaulttrek.jpeg';

/** Clamp a meta description to roughly what Google renders, cutting on a word boundary. */
export function truncate(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : cut.length)}…`;
}
