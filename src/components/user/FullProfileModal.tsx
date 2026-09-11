"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import type { Profile } from "@/types/db";
import { Avatar } from "@/components/user/Avatar";
import { StatusBubble } from "@/components/user/StatusBubble";
import { UserSettings } from "@/components/user/UserSettings";
import { useMemberRoleColors } from "@/hooks/useMemberRoleColors";
import { RolePill } from "@/components/servers/RolePill";
import { openDmWith } from "@/lib/dm";
import { X } from "@phosphor-icons/react";

const TABS = ["Board", "Activity", "Mutual Friends", "Mutual Servers"] as const;

/**
 * Full-screen-ish profile modal (centered card over a darkened backdrop). Self-contained:
 * fetches its own profile, so it works both inside the app (from the profile popover) and on
 * the standalone /users/[id] route. Right-side tabs are placeholders until those features exist.
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
  const [tab, setTab] = useState<(typeof TABS)[number]>("Board");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const { colorFor, rolesFor } = useMemberRoleColors(serverId);
  const isSelf = user?.id === userId;

  useEffect(() => {
    let active = true;
    supabase.from("profiles").select("*").eq("id", userId).single().then(({ data }) => {
      if (!active) return;
      if (data) setProfile(data as Profile);
      else setNotFound(true);
    });
    return () => { active = false; };
  }, [supabase, userId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="relative flex w-full max-w-4xl h-[85vh] max-h-[680px] overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-surface-2/80 text-muted hover:text-ink"
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
                <div className="-mt-12 mb-1 w-fit rounded-full ring-4 ring-surface">
                  <Avatar url={profile.avatar_url} name={profile.display_name} size="xl" />
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
                <div className="text-sm text-muted">@{profile.username}</div>

                <div className="mt-4">
                  {isSelf ? (
                    <button
                      onClick={() => setEditing(true)}
                      className="w-full rounded-lg bg-surface-2 py-2 text-sm font-medium text-ink hover:bg-surface"
                    >
                      Edit Profile
                    </button>
                  ) : (
                    <button
                      onClick={message}
                      disabled={busy}
                      className="w-full rounded-lg bg-accent py-2 text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-50"
                    >
                      {busy ? "…" : "Message"}
                    </button>
                  )}
                </div>

                {profile.bio && (
                  <div className="mt-5">
                    <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">About Me</h2>
                    <p className="whitespace-pre-wrap text-sm text-ink">{profile.bio}</p>
                  </div>
                )}

                <div className="mt-5">
                  <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Member Since</h2>
                  <p className="text-sm text-ink">{memberSince}</p>
                </div>

                {roles.length > 0 && (
                  <div className="mt-5">
                    <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Roles</h2>
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
                {TABS.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`-mb-px border-b-2 pb-2 text-sm font-medium ${
                      tab === t ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted">
                Nothing here yet.
              </div>
            </div>
          </>
        )}
      </div>
      {editing && createPortal(<UserSettings onClose={() => setEditing(false)} />, document.body)}
    </div>
  );
}
