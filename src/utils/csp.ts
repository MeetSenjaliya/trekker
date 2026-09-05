/**
 * The Content-Security-Policy, built per request.
 *
 * It used to live in `next.config.mjs`, which could only emit one fixed string
 * for every response. `script-src` now carries a per-request nonce, so the
 * policy has to be minted where the request is — the proxy — and this module is
 * its only caller. `next.config.mjs` keeps the headers that really are static.
 *
 * `NODE_ENV` is trustworthy here, unlike in `next.config.mjs` where it is still
 * unset while the config loads (see Known Gotchas in FEATURES.md).
 */

const originOf = (url: string | undefined) => {
  try {
    return new URL(url!).origin
  } catch {
    return ''
  }
}

const supabaseOrigin = originOf(process.env.NEXT_PUBLIC_SUPABASE_URL)

// Realtime chat opens a WebSocket to the same host over wss://, which
// connect-src treats as a separate origin from the https:// REST calls.
const supabaseSocketOrigin = supabaseOrigin.replace(/^https:/, 'wss:')

// DSN shape: https://<key>@o<org>.ingest.<region>.sentry.io/<project>
const sentry = (() => {
  try {
    const dsn = new URL(process.env.NEXT_PUBLIC_SENTRY_DSN!)
    return {
      origin: dsn.origin,
      reportUri: `${dsn.origin}/api${dsn.pathname}/security/?sentry_key=${dsn.username}`,
    }
  } catch {
    return { origin: '', reportUri: '' }
  }
})()

export const REPORT_GROUP = 'csp-endpoint'
export const cspReportUri = sentry.reportUri

// Report-only until CSP_ENFORCE is set, so the policy can be promoted from the
// hosting dashboard without a code change.
export const cspHeaderName = process.env.CSP_ENFORCE
  ? 'Content-Security-Policy'
  : 'Content-Security-Policy-Report-Only'

export function buildCsp(nonce: string) {
  const isDev = process.env.NODE_ENV === 'development'

  return [
    `default-src 'self'`,
    // Next tags every script it emits — the framework bundles, the inline
    // hydration/flight chunks — with this nonce once it sees the header on the
    // request; JsonLd is the one script of ours that has to ask for it. That
    // requires request-time rendering: a prerendered page has no nonce to carry,
    // which is why the four static routes call connection(). 'strict-dynamic'
    // extends the trust to what those scripts load, and makes CSP3 browsers
    // ignore the 'self' that CSP2 browsers still need.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? ` 'unsafe-eval'` : ''}`,
    // Emotion/MUI inject <style> at runtime; Framer Motion writes style attrs.
    // A nonce cannot cover a style attribute at all, so this one stays.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: ${supabaseOrigin} https://images.unsplash.com https://www.transparenttextures.com`,
    `font-src 'self' data:`,
    `connect-src 'self' ${supabaseOrigin} ${supabaseSocketOrigin} https://api.pwnedpasswords.com ${sentry.origin}`,
    // Nothing spawns a worker: compressImage() runs on the main thread
    // because the library's worker fetches itself from a CDN.
    `worker-src 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
    // report-uri is deprecated but still the only one Safari/Firefox read;
    // Chrome needs report-to plus the Reporting-Endpoints header from
    // next.config.mjs, and rejects a report-only policy outright when neither
    // is present.
    sentry.reportUri && `report-uri ${sentry.reportUri}`,
    sentry.reportUri && `report-to ${REPORT_GROUP}`,
  ]
    .filter(Boolean)
    .join('; ')
    .replace(/\s+/g, ' ')
}
