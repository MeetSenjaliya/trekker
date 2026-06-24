'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

// Client-side guard for pages that require a signed-in user. The middleware
// already blocks unauthenticated navigations server-side; this additionally
// bounces the page when the session disappears in-place (logout in this or
// another tab, or session expiry) so stale authenticated content can't linger.
export function useRequireAuth() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace('/');
  }, [user, loading, router]);

  return { user, loading };
}
