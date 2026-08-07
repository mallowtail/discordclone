"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import type { Permission } from "@/lib/permissions";

export function useServerPermissions(serverId: string | null): {
  perms: string[];
  isOwner: boolean;
  rank: number | null;
  has: (perm: Permission) => boolean;
  loading: boolean;
  refresh: () => void;
} {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const [perms, setPerms] = useState<string[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [rank, setRank] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!serverId || !user) {
      setPerms([]);
      setIsOwner(false);
      setRank(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [{ data: s }, { data: p }, { data: r }] = await Promise.all([
      supabase.from("servers").select("owner_id").eq("id", serverId).single(),
      supabase.rpc("my_permissions", { srv: serverId }),
      supabase.rpc("my_role_rank", { srv: serverId }),
    ]);
    setIsOwner((s?.owner_id ?? null) === user.id);
    setPerms((p as string[] | null) ?? []);
    setRank((r as number | null) ?? null);
    setLoading(false);
  }, [supabase, serverId, user]);

  useEffect(() => {
    load();
  }, [load]);

  const has = useCallback((perm: Permission) => perms.includes(perm), [perms]);

  return { perms, isOwner, rank, has, loading, refresh: load };
}
