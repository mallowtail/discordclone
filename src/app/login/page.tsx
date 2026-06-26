"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const supabase = createClient();
  const router = useRouter();
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
    router.push("/channels/general");
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm bg-surface border border-line p-6 rounded-xl space-y-3">
        <h1 className="text-xl font-bold text-white">Welcome back</h1>
        {error && <p className="text-danger text-sm">{error}</p>}
        <input className="w-full p-2 rounded-lg bg-surface-2" type="email" placeholder="Email"
          value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="w-full p-2 rounded-lg bg-surface-2" type="password" placeholder="Password"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <button disabled={busy} className="w-full p-2 rounded-lg bg-accent hover:bg-accent-strong text-white font-medium disabled:opacity-50">
          {busy ? "Logging in…" : "Log in"}
        </button>
        <p className="text-sm text-muted">
          New here? <Link href="/register" className="text-accent">Create an account</Link>
        </p>
      </form>
    </div>
  );
}
