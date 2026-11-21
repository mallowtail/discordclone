"use client"; // Error boundaries must be Client Components

import "./globals.css";
import { ErrorScreen } from "@/components/ui/ErrorScreen";

/** The root layout itself failed: replaces it, so it brings its own <html> and <body>. */
export default function GlobalError({ error }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <html lang="en">
      <body className="bg-app text-ink antialiased">
        <title>Something went wrong · Mallowchat</title>
        <ErrorScreen error={error} fullPage home={{ href: "/", label: "Go to the front page" }} />
      </body>
    </html>
  );
}
