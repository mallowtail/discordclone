"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/types/db";
import { Avatar } from "@/components/user/Avatar";
import { useProfilePopover } from "@/components/providers/ProfilePopoverProvider";
import { useServerPermissions } from "@/hooks/useServerPermissions";
import { useMemberRoleColors } from "@/hooks/useMemberRoleColors";
import { usePresence } from "@/hooks/usePresence";
import { MemberRolesDialog } from "@/components/servers/MemberRolesDialog";
import { useAuth } from "@/components/providers/AuthProvider";
import { canModerate } from "@/lib/moderation";
import { MemberModMenu } from "@/components/servers/MemberModMenu";
import { ShieldStar, Clock, Users } from "@phosphor-icons/react";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";

type Member = { user_id: string; timeout_until: string | null; profile: Profile | null };

/** Placeholder for a single member row: avatar (sm, matching `Avatar size="sm"`) + one name line. */
function MemberRowSkeleton() {
  return (
    <div className="flex items-center gap-2 p-1.5 min-h-11 md:min-h-0">
      <Skeleton className="h-6 w-6 flex-none rounded-pill" />
      <Skeleton className="h-3 w-24" />
    </div>
  );
}

export function MembersPanel({ serverId }: { serverId: string }) {
  const supabase = createClient();
  const { open } = useProfilePopover();
  const { user } = useAuth();
  const { has, isOwner, rank } = useServerPermissions(serverId);
  const { colorFor, rolesFor } = useMemberRoleColors(serverId);
  const { isOnline } = usePresence();
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [managingUser, setManagingUser] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: rows } = await supabase.from("server_members").select("user_id, timeout_until, profiles(*)").eq("server_id", serverId);
    setMembers(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rows ?? []).map((r: any) => ({ user_id: r.user_id, timeout_until: r.timeout_until, profile: r.profiles }))
    );
    setLoaded(true);
  }, [supabase, serverId]);

  useEffect(() => {
    supabase.from("servers").select("owner_id").eq("id", serverId).single()
      .then(({ data }) => setOwnerId((data as { owner_id: string | null } | null)?.owner_id ?? null));
  }, [supabase, serverId]);

  useEffect(() => {
    setLoaded(false); // switching servers: show the skeleton rather than flash the old roster
    load();
    const channel = supabase
      .channel(`members:${serverId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "server_members", filter: `server_id=eq.${serverId}` }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, serverId, load]);

  const { online, offline } = useMemo(() => {
    const online: Member[] = [];
    const offline: Member[] = [];
    for (const m of members) (isOnline(m.user_id) ? online : offline).push(m);
    return { online, offline };
  }, [members, isOnline]);

  function renderMember(m: Member) {
    const memberIsOnline = isOnline(m.user_id);
    const displayName = m.profile?.display_name ?? "Unknown";
    const targetRank = rolesFor(m.user_id).reduce((mx, r) => Math.max(mx, r.position), -1);
    const ctx = {
      isOwner, viewerRank: rank ?? -1, targetRank,
      targetIsOwner: m.user_id === ownerId, targetIsSelf: m.user_id === user?.id,
    };
    const timedOut = !!m.timeout_until && new Date(m.timeout_until) > new Date();
    return (
      <div key={m.user_id} className="flex items-center gap-2 p-1.5 min-h-11 md:min-h-0 rounded-row hover:bg-surface">
        <button
          onClick={(e) => open(m.user_id, e.currentTarget.getBoundingClientRect(), serverId)}
          aria-label={`${displayName} — ${memberIsOnline ? "Online" : "Offline"}`}
          className={`flex items-center gap-2 flex-1 min-w-0 text-left ${memberIsOnline ? "" : "opacity-50"}`}
        >
          <Avatar
            url={m.profile?.avatar_url ?? null}
            name={m.profile?.display_name}
            seed={m.user_id}
            presence={memberIsOnline ? "online" : "offline"}
            size="sm"
          />
          <div className="min-w-0">
            <div className="text-ink text-body truncate" style={{ color: colorFor(m.user_id) ?? undefined }}>
              {displayName}
            </div>
          </div>
        </button>
        {timedOut && (
          <span className="text-muted flex-none" title={`Timed out until ${new Date(m.timeout_until!).toLocaleString()}`}>
            <Clock size={14} weight="fill" />
          </span>
        )}
        <MemberModMenu
          serverId={serverId}
          targetId={m.user_id}
          targetName={m.profile?.display_name ?? "member"}
          timedOut={timedOut}
          canKick={canModerate({ ...ctx, hasPerm: has("kick_members") })}
          canBan={canModerate({ ...ctx, hasPerm: has("ban_members") })}
          canTimeout={canModerate({ ...ctx, hasPerm: has("timeout_members") })}
          onDone={load}
        />
        {has("manage_roles") && (
          <button onClick={() => setManagingUser(m.user_id)} title="Manage roles"
            className="min-h-11 min-w-11 md:min-h-0 md:min-w-0 flex items-center justify-center text-muted hover:text-ink text-meta flex-none">
            <ShieldStar size={16} />
          </button>
        )}
      </div>
    );
  }

  return (
    <aside className="w-[clamp(12.5rem,16vw,15rem)] h-full bg-sidebar border-l border-line flex flex-col">
      <div className="p-3 text-title font-semibold text-ink tracking-tight border-b border-line">
        Members
      </div>
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
        {!loaded ? (
          Array.from({ length: 6 }).map((_, i) => <MemberRowSkeleton key={i} />)
        ) : members.length === 0 ? (
          <EmptyState
            icon={<Users size={28} weight="bold" aria-hidden="true" />}
            title="No members yet"
          />
        ) : (
          <>
            {online.length > 0 && (
              <>
                <div className="px-1.5 pt-2 pb-1 text-micro font-semibold uppercase tracking-wider text-muted">
                  Online — {online.length}
                </div>
                {online.map(renderMember)}
              </>
            )}
            {offline.length > 0 && (
              <>
                <div className="px-1.5 pt-2 pb-1 text-micro font-semibold uppercase tracking-wider text-muted">
                  Offline — {offline.length}
                </div>
                {offline.map(renderMember)}
              </>
            )}
          </>
        )}
      </div>
      {managingUser && (
        <MemberRolesDialog serverId={serverId} userId={managingUser} onClose={() => setManagingUser(null)} />
      )}
    </aside>
  );
}
