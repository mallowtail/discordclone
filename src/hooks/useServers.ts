"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import type { Server } from "@/types/db";

export function useServers(): { servers: Server[]; reload: () => void } {
  const supabase = createClient();
  const { user } = useAuth();
  const [servers, setServers] = useState<Server[]>([]);

  const reload = useCallback(async () => {
    if (!user) {
      setServers([]);
      return;
    }
    const { data } = await supabase
      .from("server_members")
      .select("servers(*)")
      .eq("user_id", user.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list = (data ?? []).map((r: any) => r.servers as Server).filter(Boolean);
    list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    setServers(list);
  }, [supabase, user]);

  useEffect(() => {
    reload();
    if (!user) return;
    const channel = supabase
      .channel(`servers:${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "server_members" }, () => reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "servers" }, () => reload())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, user, reload]);

  return { servers, reload };
}
