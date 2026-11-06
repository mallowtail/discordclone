"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { ServerIcon } from "@/components/servers/ServerIcon";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkBreak } from "@phosphor-icons/react";

type Preview = { id: string; name: string; icon_url: string | null; member_count: number; status: "ok" | "expired" | "used_up" };

/** What a failed join_via_invite means, from its exception text. */
function joinErrorMessage(message: string): string {
  if (message.includes("expired") || message.includes("used up")) return "This invite has expired or reached its limit.";
  if (message.includes("banned")) return "You're banned from this server.";
  if (message.includes("invalid invite")) return "This invite doesn't exist anymore.";
  return "Couldn't join — check your connection and try again.";
}

export default function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const supabase = createClient();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [preview, setPreview] = useState<Preview | null>(null);
  const [isMember, setIsMember] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; description: string } | null>(null);
  // A failed JOIN is separate from a bad code: the card stays so the button doubles as retry.
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace(`/login?next=/invite/${encodeURIComponent(code)}`);
      return;
    }
    (async () => {
      const { data, error: err } = await supabase.rpc("server_by_invite", { code });
      const row = (data as Preview[] | null)?.[0] ?? null;
      if (err || !row) {
        setError({ title: "Invalid invite", description: "This invite doesn't exist." });
        setLoading(false);
        return;
      }
      const { data: mem } = await supabase
        .from("server_members")
        .select("server_id")
        .eq("server_id", row.id)
        .eq("user_id", user.id)
        .maybeSingle();
      // Members can always get back in, even through a link that has since expired or run out.
      if (!mem && row.status !== "ok") {
        setError({ title: "Invite expired", description: "This invite has expired or reached its limit. Ask for a new one." });
        setLoading(false);
        return;
      }
      setPreview(row);
      setIsMember(!!mem);
      setLoading(false);
    })();
  }, [authLoading, user, code, supabase, router]);

  async function join() {
    setBusy(true);
    setJoinError(null);
    if (isMember && preview) {
      router.replace(`/channels/first?server=${preview.id}`);
      return;
    }
    const { data, error: err } = await supabase.rpc("join_via_invite", { code });
    if (err || !data) {
      setBusy(false);
      return setJoinError(joinErrorMessage(err?.message ?? ""));
    }
    router.replace(`/channels/first?server=${data}`);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-surface border border-line p-6 rounded-card text-center">
        {loading ? (
          <div aria-busy="true">
            <div className="flex justify-center mb-3">
              <Skeleton className="h-14 w-14 rounded-card" />
            </div>
            <Skeleton className="h-5 w-40 mx-auto mb-2" />
            <Skeleton className="h-3 w-24 mx-auto mb-4" />
            <Skeleton className="h-9 w-full rounded-control" />
          </div>
        ) : error ? (
          <EmptyState
            icon={<LinkBreak size={32} weight="bold" aria-hidden="true" />}
            title={error.title}
            description={error.description}
            action={
              <Link
                href="/"
                className="rounded-control bg-accent hover:bg-accent-strong text-white text-body font-medium px-3 py-1.5 inline-block"
              >
                Go home
              </Link>
            }
          />
        ) : preview ? (
          <>
            <div className="flex justify-center mb-3">
              <ServerIcon iconUrl={preview.icon_url} name={preview.name} size="lg" />
            </div>
            <h1 className="text-title font-semibold text-ink tracking-tight">{preview.name}</h1>
            <p className="text-body text-muted mb-4">
              {preview.member_count} {preview.member_count === 1 ? "member" : "members"}
            </p>
            {joinError && <p role="alert" className="text-danger text-body mb-3">{joinError}</p>}
            <button onClick={join} disabled={busy}
              className="w-full bg-accent hover:bg-accent-strong text-white font-medium rounded-control p-2 disabled:opacity-50">
              {busy ? "…" : isMember ? "Open" : "Join Server"}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
