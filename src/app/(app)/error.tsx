"use client"; // Error boundaries must be Client Components

import { ErrorScreen } from "@/components/ui/ErrorScreen";

/** A page inside the signed-in app throws: the rail and sidebars stay, the page area shows this. */
export default function AppError({ error }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <ErrorScreen error={error} home={{ href: "/dms", label: "Go to your messages" }} />;
}
