"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { Skeleton } from "@/components/ui/Skeleton";

export default function FirstChannel() {
  const supabase = createClient();
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) return;
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
      if (chans && chans[0]) router.replace(`/channels/${chans[0].id}`);
    })();
  }, [supabase, user, loading, params, router]);

  // Purely transient: this route only ever redirects away, so there is no real shape to mirror —
  // a small skeleton stands in for the eventual header rather than another bare "Loading…" string.
  return (
    <div className="flex-1 flex items-center justify-center" role="status">
      <span className="sr-only">Opening…</span>
      <Skeleton className="h-4 w-32" />
    </div>
  );
}
