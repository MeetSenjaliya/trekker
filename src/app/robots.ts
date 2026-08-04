import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';

// Private/authenticated areas are already gated by the proxy, but crawlers still
// waste budget on them and can surface the login redirect in results.
const DISALLOW = [
  '/admin',
  '/dashboard',
  '/profile',
  '/favorites',
  '/messages',
  '/edits',
  '/review',
  '/auth',
  '/test',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: DISALLOW }],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
