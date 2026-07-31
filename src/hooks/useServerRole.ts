"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";

export function useServerRole(serverId: string | null): {
  isOwner: boolean;
  isManager: boolean;
  loading: boolean;
} {
  const supabase = createClient();
  const { user } = useAuth();
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
      const { data: s } = await supabase.from("servers").select("owner_id").eq("id", serverId).single();
      if (!active) return;
      setIsOwner((s?.owner_id ?? null) === user.id);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [supabase, serverId, user]);

  return { isOwner, isManager: isOwner, loading };
}
