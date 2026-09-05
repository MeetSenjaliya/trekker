import { withSentryConfig } from '@sentry/nextjs/config';

// The CSP itself is minted per request in `src/utils/csp.ts` — it carries a
// nonce now, so it cannot be a constant in this file. Only the endpoint
// declaration the `report-to` directive points at is static.
// DSN shape: https://<key>@o<org>.ingest.<region>.sentry.io/<project>
const sentryReportUri = (() => {
    try {
        const dsn = new URL(process.env.NEXT_PUBLIC_SENTRY_DSN);
        return `${dsn.origin}/api${dsn.pathname}/security/?sentry_key=${dsn.username}`;
    } catch {
        return '';
    }
})();

const REPORT_GROUP = 'csp-endpoint';

/** @type {import('next').NextConfig} */
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

        if (sentryReportUri) {
            headers.push({
                key: 'Reporting-Endpoints',
                value: `${REPORT_GROUP}="${sentryReportUri}"`,
            });
        }

        return [{ source: '/:path*', headers }];
    },
};

// Source-map upload only runs when SENTRY_ORG/PROJECT/AUTH_TOKEN are set
// (e.g. in CI); without them the build still succeeds, just no upload.
export default withSentryConfig(nextConfig, {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    silent: !process.env.CI,
    widenClientFileUpload: true,
});
