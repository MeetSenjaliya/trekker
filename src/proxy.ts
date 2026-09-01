import { type NextRequest } from 'next/server'
import { updateSession } from '@/utils/supabase/middleware'

export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - robots.txt / sitemap.xml (crawler entry points — they carry no session,
     *   so the auth guard below would 307 every bot to /auth/login)
     * - .well-known (Chrome DevTools probes this on every dev session)
     * Feel free to modify this pattern to include more paths.
     *
     * `missing` drops prefetch requests: updateSession() calls auth.getUser(),
     * which for a signed-in user is a network round trip to Supabase Auth, and
     * a viewport full of <Link>s fires one prefetch each. Real navigations still
     * match and stay guarded; a prefetched payload is a client-component shell,
     * and the data behind it is protected by RLS, not by this redirect.
     */
    {
      source:
        '/((?!_next/static|_next/image|favicon.ico|robots\\.txt|sitemap\\.xml|\\.well-known|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?|map)$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
}