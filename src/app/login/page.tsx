"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { safeNext } from "@/lib/servers/invite";
import { OAuthButtons, OrDivider } from "@/components/auth/OAuthButtons";
import { BotCheckField, useBotCheck } from "@/components/auth/Turnstile";
import { CAPTCHA_FAILED_MESSAGE, isCaptchaError } from "@/lib/users/captcha";
import {
  BANNED_ACCOUNT_MESSAGE, BANNED_NOTICE_KEY, hasCookie, isBannedLoginError, showBannedNotice,
} from "@/lib/users/account";

/** Did the app itself send us here as banned (see BANNED_NOTICE_KEY)? Read only; cleared after mount. */
function bannedFlagged(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (sessionStorage.getItem(BANNED_NOTICE_KEY) === "1") return true;
  } catch { /* storage blocked */ }
  return hasCookie(document.cookie, BANNED_NOTICE_KEY);
}

function LoginPageContent() {
  const supabase = createClient();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // /auth/callback sends people back here with ?error=oauth if the provider round-trip failed, and
  // ?banned=1 when Supabase refused a banned account (the app also signs banned people out to here).
  // ?banned=1 counts only with the app's own flag, so a shared link can't fake a ban.
  const [error, setError] = useState<string | null>(() =>
    showBannedNotice(params.get("banned"), bannedFlagged()) ? BANNED_ACCOUNT_MESSAGE
      : params.get("error") === "oauth" ? "That sign-in didn't go through — try again" : null
  );
  // The flag is for this one arrival: clear it so a reload or a later visit doesn't show it again.
  useEffect(() => {
    try { sessionStorage.removeItem(BANNED_NOTICE_KEY); } catch { /* storage blocked */ }
    document.cookie = `${BANNED_NOTICE_KEY}=; path=/login; max-age=0`;
  }, []);
  const [busy, setBusy] = useState(false);
  const bot = useBotCheck();
  // Settings → Delete account ends here with ?deleted=1.
  const deleted = params.get("deleted") === "1";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithPassword({
      email, password, ...(bot.token ? { options: { captchaToken: bot.token } } : {}),
    });
    setBusy(false);
    bot.reset(); // tokens are single-use
    if (err) {
      if (isBannedLoginError(err)) return setError(BANNED_ACCOUNT_MESSAGE);
      return setError(isCaptchaError(err.message) ? CAPTCHA_FAILED_MESSAGE : "Wrong email or password");
    }
    router.push(next);
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
          <h1 className="text-title font-semibold text-ink tracking-tight">Welcome back</h1>
          {deleted && !error && <p role="status" className="text-online text-meta">Your account was deleted.</p>}
          {error && <p id="form-error" role="alert" className="text-danger text-meta">{error}</p>}
          <OAuthButtons next={next} onError={setError} />
          <OrDivider />
          <div>
            <label htmlFor="email" className="block text-meta font-medium text-muted mb-1">Email</label>
            <input id="email" className="w-full px-3 py-2 rounded-control bg-surface-2 text-ink text-body border border-line focus:outline-none focus:border-accent aria-[invalid=true]:border-danger" type="email" autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)}
              aria-invalid={error ? true : undefined} aria-describedby={error ? "form-error" : undefined} />
          </div>
          <div>
            <label htmlFor="password" className="block text-meta font-medium text-muted mb-1">Password</label>
            <input id="password" className="w-full px-3 py-2 rounded-control bg-surface-2 text-ink text-body border border-line focus:outline-none focus:border-accent aria-[invalid=true]:border-danger" type="password" autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              aria-invalid={error ? true : undefined} aria-describedby={error ? "form-error" : undefined} />
          </div>
          <BotCheckField check={bot} />
          <button disabled={busy || !bot.ready} className="w-full px-3 py-2 rounded-control bg-accent hover:bg-accent-strong text-white text-body font-medium disabled:opacity-50">
            {busy ? "Logging in…" : "Log in"}
          </button>
          <p className="text-body text-muted">
            New here? <Link href="/register" className="text-accent hover:underline">Create an account</Link>
          </p>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-muted">Loading…</div>}>
      <LoginPageContent />
    </Suspense>
  );
}
