"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { validateUsername } from "@/lib/validation";

export default function RegisterPage() {
  const supabase = createClient();
  const router = useRouter();
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
    router.push("/channels/general");
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm bg-surface border border-line p-6 rounded-xl space-y-3">
        <h1 className="text-xl font-bold text-white">Create account</h1>
        {error && <p className="text-danger text-sm">{error}</p>}
        <input className="w-full p-2 rounded-lg bg-surface-2" placeholder="Username"
          value={username} onChange={(e) => setUsername(e.target.value)} />
        <input className="w-full p-2 rounded-lg bg-surface-2" type="email" placeholder="Email"
          value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="w-full p-2 rounded-lg bg-surface-2" type="password" placeholder="Password"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <button disabled={busy} className="w-full p-2 rounded-lg bg-accent hover:bg-accent-strong text-white font-medium disabled:opacity-50">
          {busy ? "Creating…" : "Register"}
        </button>
        <p className="text-sm text-muted">
          Have an account? <Link href="/login" className="text-accent">Log in</Link>
        </p>
      </form>
    </div>
  );
}
