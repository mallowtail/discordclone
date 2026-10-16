"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { validateUsername } from "@/lib/validation";
import { safeNext } from "@/lib/invite";

function RegisterPageContent() {
  const supabase = createClient();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const u = validateUsername(username);
    if (!u.ok) return setError(u.error);
    setBusy(true);

    const { data, error: signErr } = await supabase.auth.signUp({ email, password });
    if (signErr || !data.user) {
      setBusy(false);
      return setError(signErr?.message ?? "Sign up failed");
    }
    const { error: profErr } = await supabase.from("profiles").insert({
      id: data.user.id,
      username: u.value,
      display_name: u.value,
    });
    if (profErr) {
      setBusy(false);
      return setError(profErr.message.includes("duplicate") ? "Username taken" : profErr.message);
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
          <h1 className="text-title font-semibold text-ink tracking-tight">Create account</h1>
          {error && <p id="form-error" role="alert" className="text-danger text-meta">{error}</p>}
          <div>
            <label htmlFor="username" className="block text-meta font-medium text-muted mb-1">Username</label>
            <input id="username" className="w-full px-3 py-2 rounded-control bg-surface-2 text-ink text-body border border-line focus:outline-none focus:border-accent aria-[invalid=true]:border-danger" autoComplete="username"
              value={username} onChange={(e) => setUsername(e.target.value)}
              aria-invalid={error ? true : undefined} aria-describedby={error ? "form-error" : undefined} />
          </div>
          <div>
            <label htmlFor="email" className="block text-meta font-medium text-muted mb-1">Email</label>
            <input id="email" className="w-full px-3 py-2 rounded-control bg-surface-2 text-ink text-body border border-line focus:outline-none focus:border-accent aria-[invalid=true]:border-danger" type="email" autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)}
              aria-invalid={error ? true : undefined} aria-describedby={error ? "form-error" : undefined} />
          </div>
          <div>
            <label htmlFor="password" className="block text-meta font-medium text-muted mb-1">Password</label>
            <input id="password" className="w-full px-3 py-2 rounded-control bg-surface-2 text-ink text-body border border-line focus:outline-none focus:border-accent aria-[invalid=true]:border-danger" type="password" autoComplete="new-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              aria-invalid={error ? true : undefined} aria-describedby={error ? "form-error" : undefined} />
          </div>
          <button disabled={busy} className="w-full px-3 py-2 rounded-control bg-accent hover:bg-accent-strong text-white text-body font-medium disabled:opacity-50">
            {busy ? "Creating…" : "Register"}
          </button>
          <p className="text-body text-muted">
            Have an account? <Link href={`/login?next=${encodeURIComponent(next)}`} className="text-accent hover:underline">Log in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-muted">Loading…</div>}>
      <RegisterPageContent />
    </Suspense>
  );
}
