'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

export default function Error({
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
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <h1 className="text-2xl font-semibold text-slate-900">Something went wrong</h1>
      <p className="mt-2 max-w-md text-slate-600">
        An unexpected error occurred while loading this page. You can try again, and if
        the problem persists please head back home.
      </p>
      <div className="mt-6 flex gap-3">
        <button
          onClick={reset}
          className="rounded-lg bg-emerald-500 px-5 py-2.5 font-medium text-white transition hover:bg-emerald-600"
        >
          Try again
        </button>
        <a
          href="/"
          className="rounded-lg border border-slate-300 px-5 py-2.5 font-medium text-slate-700 transition hover:bg-slate-100"
        >
          Go home
        </a>
      </div>
    </div>
  );
}
