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
    setLoading(true);
    supabase
      .from("member_roles")
      .select("user_id, roles(*)")
      .eq("server_id", serverId)
      .then(({ data }) => {
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
      });
    return () => {
      active = false;
    };
  }, [supabase, serverId]);

  const rolesFor = useCallback((userId: string) => byUser.get(userId) ?? [], [byUser]);
  const colorFor = useCallback((userId: string) => topRoleColor(byUser.get(userId) ?? []), [byUser]);

  return { colorFor, rolesFor, loading };
}
