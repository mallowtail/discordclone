"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { removeTrustedDomain } from "@/lib/messages/linkGuard";

/** Sites trusted from the "Leaving Mallowchat" warning; removing one brings the warning back. */
export function TrustedSitesSection() {
  const { user, profile, refreshProfile } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sites = profile?.trusted_domains ?? [];

  async function remove(host: string) {
    if (!user) return;
    setBusy(host);
    setError(null);
    const { error: err } = await createClient()
      .from("profiles")
      .update({ trusted_domains: removeTrustedDomain(sites, host) })
      .eq("id", user.id);
    if (err) setError("Couldn't remove it — try again");
    await refreshProfile();
    setBusy(null);
  }

  return (
    <section className="mt-10">
      <h3 className="text-title font-semibold text-ink tracking-tight">Trusted sites</h3>
      <p className="mt-1 text-body text-muted">Links to these sites open without the &ldquo;Leaving Mallowchat&rdquo; warning.</p>
      {error && <p role="alert" className="mt-2 text-meta text-danger">{error}</p>}
      {sites.length === 0 ? (
        <p className="mt-3 text-body text-muted">None yet. Tick &ldquo;Trust … links from now on&rdquo; in the warning to add one.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line border border-line rounded-card overflow-hidden">
          {sites.map((host) => (
            <li key={host} className="flex items-center gap-3 px-3 py-2">
              <span className="flex-1 min-w-0 truncate text-body text-ink">{host}</span>
              <button type="button" onClick={() => remove(host)} disabled={busy === host}
                className="text-meta text-muted hover:text-danger disabled:opacity-50 min-h-11 md:min-h-0">
                {busy === host ? "…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
