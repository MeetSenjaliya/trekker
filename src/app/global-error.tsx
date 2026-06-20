'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

// Catches errors thrown in the root layout itself, where error.tsx cannot
// reach. Must render its own <html>/<body> because the layout has failed.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="antialiased bg-slate-50 min-h-screen font-sans">
        <div className="flex min-h-screen flex-col items-center justify-center px-6 py-24 text-center">
          <h1 className="text-2xl font-semibold text-slate-900">Something went wrong</h1>
          <p className="mt-2 max-w-md text-slate-600">
            The application hit an unexpected error. Please try again.
          </p>
          <button
            onClick={reset}
            className="mt-6 rounded-lg bg-emerald-500 px-5 py-2.5 font-medium text-white transition hover:bg-emerald-600"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
