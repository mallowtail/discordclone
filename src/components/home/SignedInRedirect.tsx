"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";

/**
 * Backstop for the front page: the server already sends signed-in people to their chats, but a
 * copy of the page kept by the browser's router (e.g. from before they logged in, in this same
 * tab) could still show — so if the browser has a session, go on to the chats.
 */
export function SignedInRedirect() {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading && user) router.replace("/channels/first");
  }, [user, loading, router]);
  return null;
}
