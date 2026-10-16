"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Role } from "@/types/db";
import { topRoleColor } from "@/lib/roleColor";

export function useMemberRoleColors(serverId: string | null | undefined): {
  colorFor: (userId: string) => string | null;
  rolesFor: (userId: string) => Role[];
  loading: boolean;
} {
  const supabase = useMemo(() => createClient(), []);
  const [byUser, setByUser] = useState<Map<string, Role[]>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!serverId) {
      setByUser(new Map());
      setLoading(false);
      return;
    }
    let active = true;

    async function load() {
      const { data } = await supabase
        .from("member_roles")
        .select("user_id, roles(*)")
        .eq("server_id", serverId);
      if (!active) return;
      const map = new Map<string, Role[]>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (data ?? []).forEach((row: any) => {
        const role = row.roles as Role | null;
        if (!role) return;
        const list = map.get(row.user_id) ?? [];
        list.push(role);
        map.set(row.user_id, list);
      });
      // sort each user's roles by position desc
      for (const list of map.values()) list.sort((a, b) => b.position - a.position);
      setByUser(map);
      setLoading(false);
    }

    setLoading(true);
    load();

    // Keep colours/pills live: reload when role assignments change (member_roles) or a role's
    // colour/name/position changes (roles). Both tables are in the realtime publication (0012).
    const channel = supabase
      .channel(`role-colors:${serverId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "member_roles", filter: `server_id=eq.${serverId}` },
        () => load()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "roles", filter: `server_id=eq.${serverId}` },
        () => load()
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [supabase, serverId]);

  const rolesFor = useCallback((userId: string) => byUser.get(userId) ?? [], [byUser]);
  const colorFor = useCallback((userId: string) => topRoleColor(byUser.get(userId) ?? []), [byUser]);

  return { colorFor, rolesFor, loading };
}
