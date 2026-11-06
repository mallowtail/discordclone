"use client";

import { useState } from "react";
import type { Provider } from "@supabase/supabase-js";
import { DiscordLogo, GithubLogo } from "@phosphor-icons/react";
import { createClient } from "@/lib/supabase/client";

const PROVIDERS: { id: Provider; label: string; Icon: typeof GithubLogo }[] = [
  { id: "github", label: "GitHub", Icon: GithubLogo },
  { id: "discord", label: "Discord", Icon: DiscordLogo },
];

/**
 * "Continue with …" buttons for GitHub and Discord. (No Google: the friends using this only have
 * school Google accounts, which can't sign in to outside apps.) On success the browser leaves for
 * the provider and comes back via /auth/callback, which finishes the session and sends first-timers
 * to /welcome to pick a username.
 * They sit inside the email/password <form>, so every button is type="button".
 */
export function OAuthButtons({ next, onError }: { next: string; onError: (message: string) => void }) {
  const [pending, setPending] = useState<Provider | null>(null);

  async function signIn(provider: Provider) {
    setPending(provider);
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await createClient().auth.signInWithOAuth({ provider, options: { redirectTo } });
    if (error) {
      setPending(null);
      onError("Couldn't start that sign-in — try again");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {PROVIDERS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => signIn(id)}
          disabled={pending !== null}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-control bg-surface-2 border border-line text-ink text-body font-medium hover:border-accent disabled:opacity-50"
        >
          <Icon size={18} weight="bold" aria-hidden="true" />
          {pending === id ? "Redirecting…" : `Continue with ${label}`}
        </button>
      ))}
    </div>
  );
}

export function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-meta text-muted" aria-hidden="true">
      <span className="h-px flex-1 bg-line" />
      or
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
