'use client';

import { useEffect } from 'react';

// Back/forward navigations can restore a page from the browser's bfcache
// without re-running middleware, so a page rendered while authenticated (or
// while logged out) can reappear after the auth state has changed — e.g.
// pressing Back after logout shows a stale signed-in page. Forcing a reload on
// a bfcache restore makes middleware run again and re-enforces the route guard.
export default function BfcacheGuard() {
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  return null;
}
