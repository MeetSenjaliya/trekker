import { Spectral, Hanken_Grotesk } from 'next/font/google';

// Auth-screen typography. Scoped to the auth panel via CSS variables (applied on
// the panel root, not <body>) so the rest of the app keeps its system-ui stack.
export const spectral = Spectral({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-spectral',
  display: 'swap',
});

export const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-hanken',
  display: 'swap',
});
