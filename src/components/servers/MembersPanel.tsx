"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/types/db";
import { Avatar } from "@/components/user/Avatar";
import { useProfilePopover } from "@/components/providers/ProfilePopoverProvider";
import { useServerPermissions } from "@/hooks/useServerPermissions";
import { useMemberRoleColors } from "@/hooks/useMemberRoleColors";
import { MemberRolesDialog } from "@/components/servers/MemberRolesDialog";
import { X, ShieldStar } from "@phosphor-icons/react";

type Member = { user_id: string; role: "admin" | "member"; profile: Profile | null };

export function MembersPanel({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const supabase = createClient();
  const { open } = useProfilePopover();
  const { has } = useServerPermissions(serverId);
  const { colorFor } = useMemberRoleColors(serverId);
  const [members, setMembers] = useState<Member[]>([]);
  const [managingUser, setManagingUser] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: rows } = await supabase.from("server_members").select("user_id, role, profiles(*)").eq("server_id", serverId);
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

  return (
    <aside className="w-56 bg-sidebar border-l border-line flex flex-col">
      <div className="p-3 font-semibold text-ink tracking-tight border-b border-line flex items-center justify-between">
        <span>Members</span>
        <button onClick={onClose} aria-label="Close" className="text-muted hover:text-ink text-sm">
          <X size={16} weight="bold" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
        {members.map((m) => (
          <div key={m.user_id} className="flex items-center gap-2 p-1.5 rounded hover:bg-surface">
            <button
              onClick={(e) => open(m.user_id, e.currentTarget.getBoundingClientRect(), serverId)}
              className="flex items-center gap-2 flex-1 min-w-0 text-left"
            >
              <Avatar url={m.profile?.avatar_url ?? null} name={m.profile?.display_name} size="sm" />
              <div className="min-w-0">
                <div className="text-ink text-sm truncate" style={{ color: colorFor(m.user_id) ?? undefined }}>
                  {m.profile?.display_name ?? "Unknown"}
                </div>
              </div>
            </button>
            {has("manage_roles") && (
              <button onClick={() => setManagingUser(m.user_id)} title="Manage roles"
                className="text-muted hover:text-ink text-xs flex-none">
                <ShieldStar size={16} />
              </button>
            )}
          </div>
        ))}
      </div>
      {managingUser && (
        <MemberRolesDialog serverId={serverId} userId={managingUser} onClose={() => setManagingUser(null)} />
      )}
    </aside>
  );
}
