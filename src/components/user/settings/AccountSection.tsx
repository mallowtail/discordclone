"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { TrustedSitesSection } from "@/components/user/settings/TrustedSitesSection";
import { DeleteAccountSection } from "@/components/user/settings/DeleteAccountSection";
import { BotCheckField, useBotCheck } from "@/components/auth/Turnstile";
import { CAPTCHA_FAILED_MESSAGE, isCaptchaError } from "@/lib/users/captcha";
import { hasPasswordLogin, verifyPassword } from "@/lib/users/account";

const PASSWORD_MIN = 8;

export function AccountSection() {
  const supabase = createClient();
  const { user } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const bot = useBotCheck();

  async function changePassword() {
    setDone(false);
    setError(null);
    if (next.length < PASSWORD_MIN) return setError(`New password must be at least ${PASSWORD_MIN} characters`);
    if (next !== confirm) return setError("New passwords don't match");
    if (!user?.email) return setError("No email on this account");

    setBusy(true);
    // Verify the current password by re-authenticating.
    const reauth = await verifyPassword(supabase, user.email, current, bot.token);
    bot.reset(); // tokens are single-use
    if (!reauth.ok) {
      setBusy(false);
      return setError(isCaptchaError(reauth.error) ? CAPTCHA_FAILED_MESSAGE : "Current password is incorrect");
    }
    const { error: updErr } = await supabase.auth.updateUser({ password: next });
    setBusy(false);
    if (updErr) return setError("Couldn't update password — try again");
    setCurrent("");
    setNext("");
    setConfirm("");
    setDone(true);
  }

  return (
    <div className="max-w-xl">
      <h2 className="text-title font-semibold text-ink tracking-tight mb-4">Account</h2>

      <div className="mb-6">
        <label className="text-micro font-semibold uppercase tracking-wider text-muted">Email</label>
        <input
          value={user?.email ?? ""}
          readOnly
          className="w-full p-2 rounded-control bg-surface-2 text-muted text-body mt-1 cursor-not-allowed"
        />
        <p className="text-muted text-meta mt-1">Email can&apos;t be changed here.</p>
      </div>

      <h3 className="text-body font-semibold text-ink mb-3">Change password</h3>
      {user && !hasPasswordLogin(user) ? (
        <p className="text-muted text-body">You sign in with Discord or GitHub, so there&apos;s no password to change.</p>
      ) : (<>
      {error && <p className="text-danger text-body mb-3">{error}</p>}
      {done && <p className="text-online text-body mb-3">Password updated</p>}

      <div className="space-y-4">
        <div>
          <label className="text-micro font-semibold uppercase tracking-wider text-muted">Current password</label>
          <input
            type="password"
            value={current}
            onChange={(e) => { setCurrent(e.target.value); setDone(false); }}
            className="w-full p-2 rounded-control bg-surface-2 text-ink text-body mt-1"
          />
        </div>
        <div>
          <label className="text-micro font-semibold uppercase tracking-wider text-muted">New password</label>
          <input
            type="password"
            value={next}
            onChange={(e) => { setNext(e.target.value); setDone(false); }}
            className="w-full p-2 rounded-control bg-surface-2 text-ink text-body mt-1"
          />
        </div>
        <div>
          <label className="text-micro font-semibold uppercase tracking-wider text-muted">Confirm new password</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => { setConfirm(e.target.value); setDone(false); }}
            className="w-full p-2 rounded-control bg-surface-2 text-ink text-body mt-1"
          />
        </div>
        <BotCheckField check={bot} />
        <button
          onClick={changePassword}
          disabled={busy || !bot.ready}
          className="bg-accent hover:bg-accent-strong text-white font-medium rounded-control px-5 py-2 disabled:opacity-50"
        >
          {busy ? "Updating…" : "Update password"}
        </button>
      </div>
      </>)}
      <TrustedSitesSection />
      <DeleteAccountSection />
    </div>
  );
}
