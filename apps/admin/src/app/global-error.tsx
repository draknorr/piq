'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

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
      <body>
        <main className="flex min-h-screen items-center justify-center bg-surface px-6 text-text-primary">
          <div className="w-full max-w-sm">
            <p className="text-caption font-medium uppercase tracking-wide text-text-muted">
              PublisherIQ
            </p>
            <h1 className="mt-2 text-heading-sm">Something went wrong</h1>
            <p className="mt-2 text-body-sm text-text-secondary">
              The error was captured for triage. You can try reloading this view.
            </p>
            <button
              type="button"
              onClick={reset}
              className="mt-5 inline-flex h-9 items-center rounded-md bg-accent-primary px-4 text-body-sm font-medium text-white transition-colors hover:bg-accent-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
