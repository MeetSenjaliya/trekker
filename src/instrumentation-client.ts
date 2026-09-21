import * as Sentry from '@sentry/nextjs';
import { scrubConsoleBreadcrumb } from '@/lib/log';

// Browser Sentry init. No DSN → no-op, inert until NEXT_PUBLIC_SENTRY_DSN is set.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 1,
    // console.error breadcrumbs carry the raw arguments; keep DB row data out.
    beforeBreadcrumb: scrubConsoleBreadcrumb,
  });
}

// Required for Sentry to trace App Router client-side navigations.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
