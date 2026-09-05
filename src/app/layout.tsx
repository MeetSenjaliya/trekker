import type { Metadata } from 'next';
import { connection } from 'next/server';
import './globals.css';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import BfcacheGuard from '@/components/layout/BfcacheGuard';
import { AuthProvider } from '@/contexts/AuthContext';
import Providers from './providers';
import WeatherEffect from '@/components/ui/WeatherEffect';
import { siteUrl, SITE_NAME } from '@/lib/site';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  // `template` lets each page set only its own name; the suffix is appended here.
  title: {
    default: 'Trek Buddies - Explore Together',
    template: `%s | ${SITE_NAME}`,
  },
  description: 'Join our community of passionate trekkers and discover breathtaking landscapes, forge lasting friendships, and create unforgettable memories.',
  keywords: 'trekking, hiking, adventure, travel, community, mountains, outdoor',
  authors: [{ name: 'Trek Buddies Team' }],
  openGraph: {
    title: 'Trek Buddies - Explore Together',
    description: 'Join our community of passionate trekkers and discover breathtaking landscapes.',
    type: 'website',
    siteName: SITE_NAME,
    locale: 'en_IN',
  },
  twitter: {
    card: 'summary_large_image',
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Every page has to render at request time, because the CSP nonce the proxy
  // mints only exists once there is a request: a prerendered page would carry
  // no nonce on its script tags and hydrate into nothing under the policy.
  // Costs less than it reads — the proxy's auth.getUser() already made every
  // document request a round trip, so what is given up is the React render of
  // four auth screens and /about, not a CDN hit.
  await connection();

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased bg-slate-50 min-h-screen flex flex-col font-sans">
        <Providers>
          <AuthProvider>
            <BfcacheGuard />
            <Header />
            <main className="flex-1">
              {children}
            </main>
            <Footer />
          </AuthProvider>
        </Providers>
        <WeatherEffect />
      </body>
    </html>
  );
}

