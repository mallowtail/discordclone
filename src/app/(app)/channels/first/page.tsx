"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { useServerPermissions } from "@/hooks/useServerPermissions";
import { CreateChannelDialog } from "@/components/servers/CreateChannelDialog";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import type { Category } from "@/types/db";
import { Hash, WarningCircle } from "@phosphor-icons/react";

type State =
  | { kind: "loading" }
  | { kind: "empty"; serverId: string; serverName: string; categories: Category[] }
  | { kind: "missing" };

/**
 * Opens a server: redirects to its first channel. If it has no channels, says so (with a "Create a
 * channel" button for people allowed to), and if the server can't be found, says that — rather
 * than sitting on a loading placeholder forever.
 */
export default function FirstChannel() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading } = useAuth();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [creating, setCreating] = useState(false);
  const emptyServerId = state.kind === "empty" ? state.serverId : null;
  const { has, loading: permsLoading } = useServerPermissions(emptyServerId);

  useEffect(() => {
    if (loading) return;
    if (!user) return;
    let active = true;
    (async () => {
      let serverId = params.get("server");
      if (!serverId) {
        const { data: mem } = await supabase
          .from("server_members").select("server_id, servers(created_at)")
          .eq("user_id", user.id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sorted = (mem ?? []).slice().sort((a: any, b: any) =>
          (a.servers?.created_at ?? "").localeCompare(b.servers?.created_at ?? ""));
        serverId = sorted[0]?.server_id ?? null;
      }
      if (!serverId) return router.replace("/dms");
      const { data: chans } = await supabase
        .from("channels").select("id").eq("server_id", serverId).order("position").limit(1);
      if (!active) return;
      if (chans && chans[0]) return router.replace(`/channels/${chans[0].id}`);

      // No channel to open: find out whether the server exists (and is visible) at all.
      const [{ data: server }, { data: cats }] = await Promise.all([
        supabase.from("servers").select("id, name").eq("id", serverId).maybeSingle(),
        supabase.from("categories").select("*").eq("server_id", serverId).order("position"),
      ]);
      if (!active) return;
      setState(
        server
          ? { kind: "empty", serverId: server.id, serverName: server.name, categories: (cats as Category[] | null) ?? [] }
          : { kind: "missing" }
      );
    })();
    return () => { active = false; };
  }, [supabase, user, loading, params, router]);

  if (state.kind === "missing") {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          icon={<WarningCircle size={32} weight="bold" />}
          title="Server not found"
          description="It may have been deleted, or you're not a member."
          action={<BackLink />}
        />
      </div>
    );
  }

  if (state.kind === "empty") {
    const canCreate = !permsLoading && has("manage_channels");
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          icon={<Hash size={32} weight="bold" />}
          title={`${state.serverName} has no channels yet`}
          description={canCreate ? "Create one to start chatting." : "Ask someone who manages this server to create one."}
          action={
            canCreate ? (
              <button type="button" onClick={() => setCreating(true)}
                className="rounded-control bg-accent hover:bg-accent-strong text-white text-body font-medium px-3 py-1.5">
                Create a channel
              </button>
            ) : (
              <BackLink />
            )
          }
        />
        {creating && (
          <CreateChannelDialog serverId={state.serverId} categories={state.categories} onClose={() => setCreating(false)} />
        )}
      </div>
    );
  }

  // Normally transient: this route redirects away as soon as it finds the first channel.
  return (
    <div className="flex-1 flex items-center justify-center" role="status">
      <span className="sr-only">Opening…</span>
      <Skeleton className="h-4 w-32" />
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/dms" className="rounded-control bg-accent hover:bg-accent-strong text-white text-body font-medium px-3 py-1.5">
      Back to Direct Messages
    </Link>
  );
}
