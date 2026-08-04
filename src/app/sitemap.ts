import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';
import { getIndexableTrekIds, getIndexableCompanies } from '@/lib/server-queries';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [trekIds, companies] = await Promise.all([
    getIndexableTrekIds(),
    getIndexableCompanies(),
  ]);

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${siteUrl}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${siteUrl}/explore`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${siteUrl}/about`, changeFrequency: 'monthly', priority: 0.5 },
  ];

  // treks has no updated_at column, so trek entries carry no lastModified.
  const trekRoutes: MetadataRoute.Sitemap = trekIds.map((id) => ({
    url: `${siteUrl}/trek/${id}`,
    changeFrequency: 'weekly',
    priority: 0.8,
  }));

  const companyRoutes: MetadataRoute.Sitemap = companies.map((c) => ({
    url: `${siteUrl}/company/${c.slug}`,
    lastModified: new Date(c.created_at),
    changeFrequency: 'weekly',
    priority: 0.7,
  }));

  return [...staticRoutes, ...trekRoutes, ...companyRoutes];
}
