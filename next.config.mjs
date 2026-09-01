import { withSentryConfig } from '@sentry/nextjs';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

const supabaseOrigin = (() => {
    try {
        return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin;
    } catch {
        return '';
    }
})();

// Realtime chat opens a WebSocket to the same host over wss://, which
// connect-src treats as a separate origin from the https:// REST calls.
const supabaseSocketOrigin = supabaseOrigin.replace(/^https:/, 'wss:');

// DSN shape: https://<key>@o<org>.ingest.<region>.sentry.io/<project>
const sentry = (() => {
    try {
        const dsn = new URL(process.env.NEXT_PUBLIC_SENTRY_DSN);
        return {
            origin: dsn.origin,
            reportUri: `${dsn.origin}/api${dsn.pathname}/security/?sentry_key=${dsn.username}`,
        };
    } catch {
        return { origin: '', reportUri: '' };
    }
})();

const REPORT_GROUP = 'csp-endpoint';

// NODE_ENV is not yet set when this config is loaded, so dev is detected from
// the phase Next passes in rather than from the environment.
function buildCsp(isDev) {
    return [
        `default-src 'self'`,
        // Next emits inline hydration/flight scripts and JsonLd inlines JSON-LD.
        // Nonces would require per-request middleware, forcing every page dynamic
        // and losing the static SEO rendering, so inline stays allowed.
        `script-src 'self' 'unsafe-inline'${isDev ? ` 'unsafe-eval'` : ''}`,
        // Emotion/MUI inject <style> at runtime; Framer Motion writes style attrs.
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
        // Chrome needs report-to plus the Reporting-Endpoints header below, and
        // rejects a report-only policy outright when neither is present.
        sentry.reportUri && `report-uri ${sentry.reportUri}`,
        sentry.reportUri && `report-to ${REPORT_GROUP}`,
    ]
        .filter(Boolean)
        .join('; ')
        .replace(/\s+/g, ' ');
}

// Report-only until CSP_ENFORCE is set, so the policy can be promoted from the
// hosting dashboard without a code change.
const cspEnforced = Boolean(process.env.CSP_ENFORCE);
const cspHeaderName = cspEnforced
    ? 'Content-Security-Policy'
    : 'Content-Security-Policy-Report-Only';

/** @type {(phase: string) => import('next').NextConfig} */
export default function config(phase) {
    const nextConfig = {
        images: {
            remotePatterns: [
                {
                    protocol: 'https',
                    hostname: 'dtjmyqogeozrzzbdjokr.supabase.co',
                    port: '',
                    pathname: '/storage/v1/object/public/**',
                },
                {
                    protocol: 'https',
                    hostname: 'images.unsplash.com',
                    port: '',
                    pathname: '/**',
                },
            ],
        },
        async headers() {
            const headers = [
                { key: 'X-Content-Type-Options', value: 'nosniff' },
                { key: 'X-Frame-Options', value: 'DENY' },
                {
                    key: 'Referrer-Policy',
                    value: 'strict-origin-when-cross-origin',
                },
                {
                    key: 'Permissions-Policy',
                    value: 'camera=(), microphone=(), geolocation=(), payment=()',
                },
                // No preload: it is effectively irreversible and binds every
                // future subdomain.
                {
                    key: 'Strict-Transport-Security',
                    value: 'max-age=31536000; includeSubDomains',
                },
            ];

            // A report-only policy with nowhere to report enforces nothing and
            // reports nothing — the browser discards it and logs a console
            // error. Send the header only when it can enforce or actually
            // report (NEXT_PUBLIC_SENTRY_DSN set).
            if (cspEnforced || sentry.reportUri) {
                headers.unshift({
                    key: cspHeaderName,
                    value: buildCsp(phase === PHASE_DEVELOPMENT_SERVER),
                });
            }
            if (sentry.reportUri) {
                headers.push({
                    key: 'Reporting-Endpoints',
                    value: `${REPORT_GROUP}="${sentry.reportUri}"`,
                });
            }

            return [{ source: '/:path*', headers }];
        },
    };

    // Source-map upload only runs when SENTRY_ORG/PROJECT/AUTH_TOKEN are set
    // (e.g. in CI); without them the build still succeeds, just no upload.
    return withSentryConfig(nextConfig, {
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        authToken: process.env.SENTRY_AUTH_TOKEN,
        silent: !process.env.CI,
        widenClientFileUpload: true,
    });
}
