"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { safeNext } from "@/lib/invite";

function LoginPageContent() {
  const supabase = createClient();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) return setError("Wrong email or password");
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
          {error && <p id="form-error" role="alert" className="text-danger text-meta">{error}</p>}
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
          <button disabled={busy} className="w-full px-3 py-2 rounded-control bg-accent hover:bg-accent-strong text-white text-body font-medium disabled:opacity-50">
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
