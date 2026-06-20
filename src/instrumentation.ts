import * as Sentry from '@sentry/nextjs';

// Server + edge Sentry init. No DSN set → no-op, so this is inert until
// NEXT_PUBLIC_SENTRY_DSN (or SENTRY_DSN) is configured in the environment.
export async function register() {
  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  if (process.env.NEXT_RUNTIME === 'nodejs' || process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init({
      dsn,
      // Lower this in high-traffic production to control quota.
      tracesSampleRate: 1,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
