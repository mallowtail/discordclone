"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { safeNext } from "@/lib/invite";
import { validateUsername } from "@/lib/validation";
import { avatarFrom, displayNameFrom, suggestUsername } from "@/lib/oauthProfile";

// First stop after a Google/GitHub/Discord sign-in for anyone without a profile row yet. Email
// sign-ups pick a username on /register; OAuth skips that form, so they pick one here.
function WelcomeContent() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const { user, profile, profileLoaded, loading, refreshProfile, signOut } = useAuth();
  // null until the user types: the field shows the suggestion from their provider profile until then.
  const [typed, setTyped] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const meta = user?.user_metadata;
  const username = typed ?? suggestUsername(meta);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
    else if (profileLoaded && profile) router.replace(next); // already set up — nothing to do here
  }, [loading, user, profileLoaded, profile, next, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError(null);
    const u = validateUsername(username);
    if (!u.ok) return setError(u.error);
    setBusy(true);
    const { error: insErr } = await createClient().from("profiles").insert({
      id: user.id,
      username: u.value,
      display_name: displayNameFrom(meta, u.value),
      avatar_url: avatarFrom(meta),
    });
    if (insErr) {
      setBusy(false);
      return setError(insErr.message.includes("duplicate") ? "That username's taken — try another" : insErr.message);
    }
    await refreshProfile();
    router.replace(next);
  }

  async function cancel() {
    await signOut();
    router.replace("/login");
  }

  if (loading || !user || !profileLoaded || profile) {
    return <div className="min-h-screen flex items-center justify-center bg-app text-muted">Loading…</div>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-app">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 mb-6">
          <svg width="48" height="48" viewBox="0 0 32 32" aria-hidden="true">
            <path fill="var(--color-accent)" d="M9 7h14a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4h-7l-5.5 4.5a.6.6 0 0 1-1-.46V23H9a4 4 0 0 1-4-4v-8a4 4 0 0 1 4-4z" />
            <circle cx="12" cy="15" r="1.7" fill="var(--color-app)" />
            <circle cx="16" cy="15" r="1.7" fill="var(--color-app)" />
            <circle cx="20" cy="15" r="1.7" fill="var(--color-app)" />
          </svg>
          <span className="text-display font-semibold text-ink tracking-tight">Mallowchat</span>
        </div>
        <form onSubmit={onSubmit} className="bg-surface border border-line p-8 rounded-modal space-y-4">
          <div>
            <h1 className="text-title font-semibold text-ink tracking-tight">Pick a username</h1>
            <p className="text-body text-muted mt-1">
              You&apos;re signed in{user.email ? ` as ${user.email}` : ""}. This is how others will find you.
            </p>
          </div>
          {error && <p id="form-error" role="alert" className="text-danger text-meta">{error}</p>}
          <div>
            <label htmlFor="username" className="block text-meta font-medium text-muted mb-1">Username</label>
            <input
              id="username"
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setTyped(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "form-error" : "username-hint"}
              className="w-full px-3 py-2 rounded-control bg-surface-2 text-ink text-body border border-line focus:outline-none focus:border-accent aria-[invalid=true]:border-danger"
            />
            <p id="username-hint" className="text-meta text-muted mt-1">3–20 letters, numbers, or underscores.</p>
          </div>
          <button
            disabled={busy}
            className="w-full px-3 py-2 rounded-control bg-accent hover:bg-accent-strong text-white text-body font-medium disabled:opacity-50"
          >
            {busy ? "Saving…" : "Continue"}
          </button>
          <button type="button" onClick={cancel} className="w-full text-body text-muted hover:text-ink">
            Use a different account
          </button>
        </form>
      </div>
    </div>
  );
}

export default function WelcomePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-app text-muted">Loading…</div>}>
      <WelcomeContent />
    </Suspense>
  );
}
