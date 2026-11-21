"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";

// One `is_site_admin()` check per signed-in account per page load, shared by every caller
// (the user panel's Admin button and /admin itself). The database still guards every admin call.
let cached: { userId: string; value: boolean } | null = null;
let inFlight: { userId: string; promise: Promise<boolean> } | null = null;

function check(userId: string): Promise<boolean> {
  if (inFlight?.userId === userId) return inFlight.promise;
  const promise = Promise.resolve(createClient().rpc("is_site_admin")).then(({ data, error }) => {
    const value = !error && data === true;
    // A failed check isn't cached, so the next mount asks again.
    if (!error) cached = { userId, value };
    return value;
  }).finally(() => {
    if (inFlight?.promise === promise) inFlight = null;
  });
  inFlight = { userId, promise };
  return promise;
}

/** Is the signed-in account the site admin? `null` while checking (and when signed out: false). */
export function useIsSiteAdmin(): boolean | null {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [result, setResult] = useState<{ userId: string; value: boolean } | null>(() =>
    cached && cached.userId === userId ? cached : null,
  );

  useEffect(() => {
    if (!userId) return;
    if (cached?.userId === userId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronous cache hit (another component already asked)
      setResult(cached);
      return;
    }
    let active = true;
    check(userId).then((value) => {
      if (active) setResult({ userId, value });
    });
    return () => { active = false; };
  }, [userId]);

  if (!userId) return false;
  return result?.userId === userId ? result.value : null;
}
