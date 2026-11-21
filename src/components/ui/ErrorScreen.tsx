"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/errors/clientReporter";

/**
 * What an error boundary shows instead of a blank page: "Something went wrong" with Reload. It
 * also sends the error to the built-in error log (/admin → Errors) and the console, so catching
 * an error never hides it. `fullPage` fills the screen (outside the app shell).
 */
export function ErrorScreen({
  error,
  fullPage = false,
  home,
}: {
  error: Error & { digest?: string };
  fullPage?: boolean;
  /** A way out besides reloading, e.g. back to the chats. */
  home?: { href: string; label: string };
}) {
  useEffect(() => {
    console.error(error);
    reportClientError(error, "boundary", error.digest);
  }, [error]);

  return (
    <div className={`${fullPage ? "min-h-screen" : "flex-1 min-h-0 h-full"} flex items-center justify-center p-4 bg-app`}>
      <div role="alert" className="w-full max-w-sm bg-surface border border-line rounded-modal p-6 sm:p-8 text-center">
        <svg width="40" height="40" viewBox="0 0 32 32" aria-hidden="true" className="mx-auto mb-3">
          <path fill="var(--color-accent)" d="M9 7h14a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4h-7l-5.5 4.5a.6.6 0 0 1-1-.46V23H9a4 4 0 0 1-4-4v-8a4 4 0 0 1 4-4z" />
          <circle cx="12" cy="15" r="1.7" fill="var(--color-app)" />
          <circle cx="16" cy="15" r="1.7" fill="var(--color-app)" />
          <circle cx="20" cy="15" r="1.7" fill="var(--color-app)" />
        </svg>
        <h1 className="text-title font-semibold text-ink tracking-tight">Something went wrong</h1>
        <p className="mt-1 text-body text-muted">This page hit an error. Reloading usually fixes it.</p>
        <button type="button" onClick={() => window.location.reload()}
          className="mt-5 w-full px-3 py-2 min-h-11 rounded-control bg-accent hover:bg-accent-strong text-white text-body font-medium">
          Reload
        </button>
        {home && (
          // A plain link (full page load), so a broken client-side state can't break the way out.
          <a href={home.href} className="mt-3 inline-block text-meta text-muted hover:text-ink hover:underline">
            {home.label}
          </a>
        )}
      </div>
    </div>
  );
}
