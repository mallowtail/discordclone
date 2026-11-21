"use client"; // Error boundaries must be Client Components

import { ErrorScreen } from "@/components/ui/ErrorScreen";

/** Any page outside the signed-in app (front page, login, invite, …) that throws while rendering. */
export default function RootError({ error }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <ErrorScreen error={error} fullPage home={{ href: "/", label: "Go to the front page" }} />;
}
