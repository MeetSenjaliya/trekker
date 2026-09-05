import { type NextRequest } from 'next/server'
import { updateSession } from '@/utils/supabase/middleware'
import { buildCsp, cspHeaderName } from '@/utils/csp'

export async function proxy(request: NextRequest) {
  // 128 bits of unguessable, and already base64-value-safe characters.
  const nonce = crypto.randomUUID().replace(/-/g, '')
  const csp = buildCsp(nonce)

  // Next mints the nonce onto its own script tags by re-reading the policy off
  // the *request*; `x-nonce` is for our own markup (JsonLd) to pick up through
  // headers(). Report-only and enforcing are both read, so the request copy
  // carries whichever name the response is about to use.
  const response = await updateSession(request, {
    'x-nonce': nonce,
    [cspHeaderName.toLowerCase()]: csp,
  })
  response.headers.set(cspHeaderName, csp)

  return response
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
     * Everything excluded here is a subresource or a text file, so none of it
     * needs the CSP the proxy now also mints — a policy only means anything on
     * the document that loads them.
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
