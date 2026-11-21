"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/types/db";

type AuthState = {
  user: User | null;
  profile: Profile | null;
  /** True once the signed-in user's profile lookup has succeeded — so `profile === null` then means
   *  "no row yet" (a first OAuth sign-in that hasn't picked a username), not "still loading". */
  profileLoaded: boolean;
  loading: boolean;
  /** `scope: "local"` only forgets this browser's session (used after deleting the account, when
   *  there's nothing left on the server to sign out of). */
  signOut: (opts?: { scope?: "global" | "local" }) => Promise<void>;
  refreshProfile: () => Promise<void>;
};
const AuthContext = createContext<AuthState>({
  user: null,
  profile: null,
  profileLoaded: false,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileFor, setProfileFor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  const refreshProfile = useCallback(async () => {
    // Read the signed-in user from the client's own session rather than the `user` state: right
    // after signUp the state can lag a render behind, and the register page calls this straight
    // after inserting the profile.
    const { data: sess } = await supabase.auth.getSession();
    const current = sess.session?.user ?? null;
    if (!current) {
      setProfile(null);
      setProfileFor(null);
      return;
    }
    const { data, error } = await supabase.from("profiles").select("*").eq("id", current.id).maybeSingle();
    setProfile((data as Profile) ?? null);
    // Only a successful lookup counts as "loaded": a network error must not look like "no profile".
    if (!error) setProfileFor(current.id);
  }, [supabase]);

  // This account was deleted from another device, or banned by the site admin: forget the session
  // here and say why. (A ban also ends the account's sessions on the server, so "local" is all
  // that's left to do.)
  const pathname = usePathname();
  const deletedAt = profile?.deleted_at;
  const bannedAt = profile?.banned_at;
  useEffect(() => {
    if ((!deletedAt && !bannedAt) || pathname.startsWith("/login")) return;
    const dest = deletedAt ? "/login?deleted=1" : "/login?banned=1";
    supabase.auth.signOut({ scope: "local" }).finally(() => { window.location.href = dest; });
  }, [deletedAt, bannedAt, pathname, supabase]);

  // An open tab finds out about a ban (or a deletion elsewhere) on its next check: when it comes
  // back into view, and every few minutes while it's open.
  useEffect(() => {
    if (!user) return;
    // Only the two flags, and the profile is reloaded only when one is set, so nothing re-renders
    // on a routine check.
    const recheck = async () => {
      if (document.visibilityState !== "visible") return;
      const { data } = await supabase.from("profiles").select("deleted_at, banned_at").eq("id", user.id).maybeSingle();
      if (data?.deleted_at || data?.banned_at) refreshProfile();
    };
    document.addEventListener("visibilitychange", recheck);
    const timer = window.setInterval(recheck, 3 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", recheck);
      window.clearInterval(timer);
    };
  }, [user, refreshProfile, supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- shared public refetch; its null-user branch clears the old profile on sign-out
    refreshProfile();
  }, [refreshProfile, user]); // re-check on every sign-in / sign-out

  const signOut = async (opts?: { scope?: "global" | "local" }) => {
    await supabase.auth.signOut(opts);
  };

  return (
    <AuthContext.Provider
      value={{ user, profile, profileLoaded: !!user && profileFor === user.id, loading, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
