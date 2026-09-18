"use client";

import { useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { useProfilePopover } from "@/components/providers/ProfilePopoverProvider";
import { Avatar } from "@/components/user/Avatar";
import { UserSettings } from "@/components/user/UserSettings";
import { usePresence } from "@/hooks/usePresence";
import { GearSix } from "@phosphor-icons/react";

export function UserPanel() {
  const { user, profile } = useAuth();
  const { open } = useProfilePopover();
  const { isOnline } = usePresence();
  const [showSettings, setShowSettings] = useState(false);
  const online = !!user && isOnline(user.id);
  const displayName = profile?.display_name ?? user?.email ?? "you";

  return (
    <>
      <div className="p-2 bg-surface-2 rounded-card flex items-center gap-1 text-body">
        {/* Clicking your avatar/name opens the little profile popover (not a full window). */}
        <button
          onClick={(e) => user && open(user.id, e.currentTarget.getBoundingClientRect())}
          aria-label={`${displayName} — ${online ? "Online" : "Offline"}`}
          className="flex items-center gap-2 min-w-0 flex-1 hover:opacity-80"
          title="View profile"
        >
          <Avatar
            url={profile?.avatar_url ?? null}
            name={profile?.display_name}
            seed={user?.id}
            presence={online ? "online" : "offline"}
            presenceRing="ring-surface-2"
            size="sm"
          />
          <span className="text-ink truncate">{displayName}</span>
        </button>
        <button
          onClick={() => setShowSettings(true)}
          aria-label="User settings"
          title="User settings"
          className="flex-none p-1 text-muted hover:text-ink"
        >
          <GearSix size={18} />
        </button>
      </div>
      {showSettings && <UserSettings onClose={() => setShowSettings(false)} />}
    </>
  );
}
