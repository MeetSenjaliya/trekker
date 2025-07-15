import type { Metadata } from 'next';
import { Inter, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { AuthProvider } from '@/contexts/AuthContext';

const inter = Inter({ subsets: ['latin'] });
const plusJakarta = Plus_Jakarta_Sans({ 
  subsets: ['latin'],
  variable: '--font-plus-jakarta'
});

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
    <html lang="en" className={`${plusJakarta.variable}`}>
      <body className={`${inter.className} antialiased bg-slate-50 min-h-screen flex flex-col`}>
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

