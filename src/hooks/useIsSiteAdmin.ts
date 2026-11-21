"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";

// One `is_site_admin()` check per signed-in account per page load, shared by every caller
// (the user panel's Admin button and /admin itself). The database still guards every admin call.
let cached: { userId: string; value: boolean } | null = null;
let inFlight: { userId: string; promise: Promise<boolean | null> } | null = null;

/** Seconds between retries after a failed check (also retried when the window regains focus). */
const RETRY_MS = 5000;

/** true / false from the database, or null when the check itself failed (network). */
function check(userId: string): Promise<boolean | null> {
  if (inFlight?.userId === userId) return inFlight.promise;
  const promise = Promise.resolve(createClient().rpc("is_site_admin")).then(({ data, error }) => {
    if (error) return null;
    // Only a real answer is cached, so a failed check is asked again.
    const value = data === true;
    cached = { userId, value };
    return value;
  }, () => null).finally(() => {
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
    let timer: number | undefined;
    // A failed check shows "not admin" for now and asks again a few seconds later, or as soon as
    // the window comes back into focus (whichever is first), until it gets an answer.
    const run = () => {
      window.clearTimeout(timer);
      if (cached?.userId === userId) {
        // Another component got the answer meanwhile.
        setResult(cached);
        window.removeEventListener("focus", onFocus);
        return;
      }
      check(userId).then((value) => {
        if (!active) return;
        setResult({ userId, value: value === true });
        if (value === null) timer = window.setTimeout(run, RETRY_MS);
        else window.removeEventListener("focus", onFocus);
      });
    };
    const onFocus = () => run();
    window.addEventListener("focus", onFocus);
    run();
    return () => {
      active = false;
      window.clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [userId]);

  if (!userId) return false;
  return result?.userId === userId ? result.value : null;
}
