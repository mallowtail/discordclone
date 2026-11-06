"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import type { Profile, Server } from "@/types/db";
import { Avatar } from "@/components/user/Avatar";
import { StatusBubble } from "@/components/user/StatusBubble";
import { UserSettings } from "@/components/user/UserSettings";
import { useMemberRoleColors } from "@/hooks/useMemberRoleColors";
import { usePresence } from "@/hooks/usePresence";
import { RolePill } from "@/components/servers/RolePill";
import { ServerIcon } from "@/components/servers/ServerIcon";
import { FriendButton } from "@/components/user/FriendButton";
import { useFriends } from "@/components/providers/FriendsProvider";
import { openDmWith } from "@/lib/dm";
import { Modal } from "@/components/ui/Modal";
import { X } from "@phosphor-icons/react";

const TABS = ["Board", "Activity", "Mutual Friends", "Mutual Servers"] as const;
type Tab = (typeof TABS)[number];
type MutualServer = Pick<Server, "id" | "name" | "icon_url">;

/**
 * Full-screen-ish profile modal (centered card over a darkened backdrop). Self-contained:
 * fetches its own profile, so it works both inside the app (from the profile popover) and on
 * the standalone /users/[id] route. Board and Activity are placeholders until those features exist;
 * the mutual tabs are hidden on your own profile.
 */
export function FullProfileModal({
  userId,
  serverId,
  onClose,
}: {
  userId: string;
  serverId?: string;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<Tab>("Board");
  const [mutualFriends, setMutualFriends] = useState<Profile[] | null>(null);
  const [mutualServers, setMutualServers] = useState<MutualServer[] | null>(null);
  const { friends } = useFriends();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const { colorFor, rolesFor } = useMemberRoleColors(serverId);
  const { isOnline } = usePresence();
  const isSelf = user?.id === userId;
  const online = isOnline(userId);

  useEffect(() => {
    let active = true;
    supabase.from("profiles").select("*").eq("id", userId).single().then(({ data }) => {
      if (!active) return;
      if (data) setProfile(data as Profile);
      else setNotFound(true);
    });
    return () => { active = false; };
  }, [supabase, userId]);

  // Mutual friends: the RPC intersects both friend lists (other people's rows aren't readable).
  // Re-run when my own friends change, e.g. after accepting a request from this profile.
  const friendIds = friends.map((f) => f.id).join(",");
  useEffect(() => {
    if (isSelf || !user) return;
    let active = true;
    supabase.rpc("mutual_friends", { other: userId }).then(({ data }) => {
      if (active) setMutualFriends((data as Profile[] | null) ?? []);
    });
    return () => { active = false; };
  }, [supabase, userId, isSelf, user, friendIds]);

  // Mutual servers: membership rows are only readable for servers I'm in, so this user's rows that
  // come back are exactly the servers we share.
  useEffect(() => {
    if (isSelf || !user) return;
    let active = true;
    supabase.from("server_members").select("servers(id, name, icon_url)").eq("user_id", userId).then(({ data }) => {
      if (!active) return;
      const list = ((data ?? []) as unknown as { servers: MutualServer | null }[])
        .map((r) => r.servers)
        .filter((x): x is MutualServer => !!x)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      setMutualServers(list);
    });
    return () => { active = false; };
  }, [supabase, userId, isSelf, user]);

  function openServer(id: string) {
    router.push(`/channels/first?server=${id}`);
    onClose();
  }

  async function message() {
    if (!user || busy) return;
    setBusy(true);
    const convId = await openDmWith(supabase, user.id, userId);
    if (!convId) { setBusy(false); return; }
    router.push(`/dms/${convId}`);
    onClose();
  }

  const memberSince = profile
    ? new Date(profile.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : "";
  const roles = serverId ? rolesFor(userId) : [];

  return (
    <>
      <Modal onClose={onClose} size="lg" height="tall">
        <div className="relative flex h-full">
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-pill bg-surface-2/80 text-muted hover:text-ink"
          >
            <X size={16} weight="bold" />
          </button>

          {notFound ? (
            <div className="p-8 text-muted">User not found.</div>
          ) : !profile ? (
            <div className="p-8 text-muted">Loading…</div>
          ) : (
            <>
              {/* Left: profile details */}
              <div className="w-[320px] flex-none overflow-y-auto border-r border-line">
                <div className="h-28 bg-gradient-to-br from-accent/60 via-mention to-app" />
                <div className="px-5 pb-6">
                  <div className="-mt-12 mb-1 w-fit rounded-pill ring-4 ring-surface">
                    <Avatar
                      url={profile.avatar_url}
                      name={profile.display_name}
                      seed={userId}
                      presence={online ? "online" : "offline"}
                      presenceRing="ring-surface"
                      size="xl"
                    />
                    <span className="sr-only">{online ? "Online" : "Offline"}</span>
                  </div>
                  {profile.status && (
                    <div className="mt-2">
                      <StatusBubble status={profile.status} />
                    </div>
                  )}
                  <h1
                    className="mt-3 text-2xl font-bold tracking-tight text-ink"
                    style={{ color: colorFor(userId) ?? undefined }}
                  >
                    {profile.display_name}
                  </h1>
                  <div className="text-body text-muted">@{profile.username}</div>

                  <div className="mt-4">
                    {isSelf ? (
                      <button
                        onClick={() => setEditing(true)}
                        className="w-full rounded-control bg-surface-2 py-2 text-body font-medium text-ink hover:bg-surface"
                      >
                        Edit Profile
                      </button>
                    ) : (
                      <button
                        onClick={message}
                        disabled={busy}
                        className="w-full rounded-control bg-accent py-2 text-body font-medium text-white hover:bg-accent-strong disabled:opacity-50"
                      >
                        {busy ? "…" : "Message"}
                      </button>
                    )}
                    {!isSelf && <div className="mt-2"><FriendButton userId={userId} full /></div>}
                  </div>

                  {profile.bio && (
                    <div className="mt-5">
                      <h2 className="mb-1 text-micro font-semibold uppercase tracking-wider text-muted">About Me</h2>
                      <p className="whitespace-pre-wrap text-body text-ink">{profile.bio}</p>
                    </div>
                  )}

                  <div className="mt-5">
                    <h2 className="mb-1 text-micro font-semibold uppercase tracking-wider text-muted">Member Since</h2>
                    <p className="text-body text-ink">{memberSince}</p>
                  </div>

                  {roles.length > 0 && (
                    <div className="mt-5">
                      <h2 className="mb-1 text-micro font-semibold uppercase tracking-wider text-muted">Roles</h2>
                      <div className="flex flex-wrap gap-1">
                        {roles.map((r) => <RolePill key={r.id} role={r} />)}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Right: tabbed content (empty for now) */}
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex gap-5 border-b border-line px-5 pt-4">
                  {TABS.filter((t) => !isSelf || !t.startsWith("Mutual")).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTab(t)}
                      aria-pressed={tab === t}
                      className={`-mb-px border-b-2 pb-2 text-body font-medium ${
                        tab === t ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
                      }`}
                    >
                      {t}
                      {t === "Mutual Friends" && mutualFriends && mutualFriends.length > 0 && ` (${mutualFriends.length})`}
                      {t === "Mutual Servers" && mutualServers && mutualServers.length > 0 && ` (${mutualServers.length})`}
                    </button>
                  ))}
                </div>
                {tab === "Mutual Friends" ? (
                  <MutualList
                    items={mutualFriends}
                    empty="No friends in common."
                    render={(f) => (
                      <li key={f.id} className="flex items-center gap-3 px-3 py-2">
                        <Avatar url={f.avatar_url} name={f.display_name} seed={f.id}
                          presence={isOnline(f.id) ? "online" : "offline"} presenceRing="ring-surface" size="sm" />
                        <span className="min-w-0 truncate text-body text-ink">
                          {f.display_name} <span className="text-muted">@{f.username}</span>
                        </span>
                      </li>
                    )}
                  />
                ) : tab === "Mutual Servers" ? (
                  <MutualList
                    items={mutualServers}
                    empty="No servers in common."
                    render={(srv) => (
                      <li key={srv.id}>
                        <button type="button" onClick={() => openServer(srv.id)}
                          className="flex w-full items-center gap-3 rounded-row px-3 py-2 text-left hover:bg-surface-2">
                          <ServerIcon iconUrl={srv.icon_url} name={srv.name} />
                          <span className="min-w-0 truncate text-body text-ink">{srv.name}</span>
                        </button>
                      </li>
                    )}
                  />
                ) : (
                  <div className="flex flex-1 items-center justify-center px-6 text-center text-body text-muted">
                    Nothing here yet.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </Modal>
      {editing && createPortal(<UserSettings onClose={() => setEditing(false)} />, document.body)}
    </>
  );
}

/** A mutual-friends/servers tab body: loading, an empty message, or the list. */
function MutualList<T>({ items, empty, render }: { items: T[] | null; empty: string; render: (item: T) => React.ReactNode }) {
  if (items === null) return <div className="p-6 text-body text-muted">Loading…</div>;
  if (items.length === 0) {
    return <div className="flex flex-1 items-center justify-center px-6 text-center text-body text-muted">{empty}</div>;
  }
  return <ul className="flex-1 overflow-y-auto p-2">{items.map(render)}</ul>;
}
