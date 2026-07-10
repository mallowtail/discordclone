"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/types/db";
import { Avatar } from "@/components/user/Avatar";
import { useServerRole } from "@/hooks/useServerRole";

type Member = { user_id: string; role: "admin" | "member"; profile: Profile | null };

export function MembersPanel({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const supabase = createClient();
  const { isManager } = useServerRole(serverId);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);

  const load = useCallback(async () => {
    const [{ data: s }, { data: rows }] = await Promise.all([
      supabase.from("servers").select("owner_id").eq("id", serverId).single(),
      supabase.from("server_members").select("user_id, role, profiles(*)").eq("server_id", serverId),
    ]);
    setOwnerId((s?.owner_id as string) ?? null);
    setMembers(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rows ?? []).map((r: any) => ({ user_id: r.user_id, role: r.role, profile: r.profiles }))
    );
  }, [supabase, serverId]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`members:${serverId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "server_members", filter: `server_id=eq.${serverId}` }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, serverId, load]);

  async function setRole(userId: string, role: "admin" | "member") {
    await supabase.from("server_members").update({ role }).eq("server_id", serverId).eq("user_id", userId);
  }

  function badge(m: Member) {
    if (m.user_id === ownerId) return <span className="text-accent text-[10px] font-semibold">OWNER</span>;
    if (m.role === "admin") return <span className="text-muted text-[10px] font-semibold bg-surface-2 rounded px-1">ADMIN</span>;
    return <span className="text-muted text-[10px]">member</span>;
  }

  return (
    <aside className="w-56 bg-sidebar border-l border-line flex flex-col">
      <div className="p-3 font-bold text-ink border-b border-line flex items-center justify-between">
        <span>Members</span>
        <button onClick={onClose} className="text-muted hover:text-ink text-sm">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
        {members.map((m) => (
          <div key={m.user_id} className="flex items-center gap-2 p-1.5 rounded hover:bg-surface">
            <Avatar url={m.profile?.avatar_url ?? null} name={m.profile?.display_name} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="text-ink text-sm truncate">{m.profile?.display_name ?? "Unknown"}</div>
              {badge(m)}
            </div>
            {isManager && m.user_id !== ownerId && (
              m.role === "admin" ? (
                <button onClick={() => setRole(m.user_id, "member")}
                  className="text-[10px] text-muted hover:text-ink">Remove admin</button>
              ) : (
                <button onClick={() => setRole(m.user_id, "admin")}
                  className="text-[10px] text-accent hover:underline">Make admin</button>
              )
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
