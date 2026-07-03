"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { canManageRole } from "@/lib/roles";

export function useServerRole(serverId: string | null): {
  role: "admin" | "member";
  isOwner: boolean;
  isManager: boolean;
  loading: boolean;
} {
  const supabase = createClient();
  const { user } = useAuth();
  const [role, setRole] = useState<"admin" | "member">("member");
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!serverId || !user) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    (async () => {
      const [{ data: s }, { data: m }] = await Promise.all([
        supabase.from("servers").select("owner_id").eq("id", serverId).single(),
        supabase.from("server_members").select("role").eq("server_id", serverId).eq("user_id", user.id).maybeSingle(),
      ]);
      if (!active) return;
      setIsOwner((s?.owner_id ?? null) === user.id);
      setRole(((m?.role as "admin" | "member") ?? "member"));
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [supabase, serverId, user]);

  return { role, isOwner, isManager: canManageRole({ isOwner, role }), loading };
}
