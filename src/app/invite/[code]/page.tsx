"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { ServerIcon } from "@/components/servers/ServerIcon";

type Preview = { id: string; name: string; icon_url: string | null; member_count: number };

export default function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const supabase = createClient();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [preview, setPreview] = useState<Preview | null>(null);
  const [isMember, setIsMember] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace(`/login?next=/invite/${code}`);
      return;
    }
    (async () => {
      const { data, error: err } = await supabase.rpc("server_by_invite", { code });
      const row = (data as Preview[] | null)?.[0] ?? null;
      if (err || !row) {
        setError("This invite is invalid or expired.");
        setLoading(false);
        return;
      }
      setPreview(row);
      const { data: mem } = await supabase
        .from("server_members")
        .select("server_id")
        .eq("server_id", row.id)
        .eq("user_id", user.id)
        .maybeSingle();
      setIsMember(!!mem);
      setLoading(false);
    })();
  }, [authLoading, user, code, supabase, router]);

  async function join() {
    setBusy(true);
    setError(null);
    if (isMember && preview) {
      router.replace(`/channels/first?server=${preview.id}`);
      return;
    }
    const { data, error: err } = await supabase.rpc("join_via_invite", { code });
    if (err || !data) {
      setBusy(false);
      return setError("Couldn't join — the invite may be invalid.");
    }
    router.replace(`/channels/first?server=${data}`);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-surface border border-line p-6 rounded-2xl text-center">
        {loading ? (
          <p className="text-muted">Loading invite…</p>
        ) : error ? (
          <p className="text-danger">{error}</p>
        ) : preview ? (
          <>
            <div className="flex justify-center mb-3">
              <ServerIcon iconUrl={preview.icon_url} name={preview.name} size="lg" />
            </div>
            <h1 className="text-lg font-bold text-ink">{preview.name}</h1>
            <p className="text-sm text-muted mb-4">
              {preview.member_count} {preview.member_count === 1 ? "member" : "members"}
            </p>
            <button onClick={join} disabled={busy}
              className="w-full bg-accent hover:bg-accent-strong text-white font-medium rounded-xl p-2 disabled:opacity-50">
              {busy ? "…" : isMember ? "Open" : "Join Server"}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
