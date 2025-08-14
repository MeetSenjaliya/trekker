import type { Metadata } from 'next';
import './globals.css';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { AuthProvider } from '@/contexts/AuthContext';

export const metadata: Metadata = {
  title: 'Trek Buddies - Explore Together',
  description: 'Join our community of passionate trekkers and discover breathtaking landscapes, forge lasting friendships, and create unforgettable memories.',
  keywords: 'trekking, hiking, adventure, travel, community, mountains, outdoor',
  authors: [{ name: 'Trek Buddies Team' }],
  openGraph: {
    title: 'Trek Buddies - Explore Together',
    description: 'Join our community of passionate trekkers and discover breathtaking landscapes.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased bg-slate-50 min-h-screen flex flex-col font-sans">
        <AuthProvider>
          <Header />
          <main className="flex-1">
            {children}
          </main>
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}

