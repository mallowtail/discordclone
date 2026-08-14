"use client";

import { useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { Avatar } from "@/components/user/Avatar";
import { UserSettings } from "@/components/user/UserSettings";

export function UserPanel() {
  const { user, profile } = useAuth();
  const [showSettings, setShowSettings] = useState(false);

  return (
    <>
      <div className="p-2 bg-surface-2 rounded-2xl flex items-center text-sm">
        <button
          onClick={() => setShowSettings(true)}
          className="flex items-center gap-2 min-w-0 hover:opacity-80 w-full"
          title="User settings"
        >
          <Avatar url={profile?.avatar_url ?? null} name={profile?.display_name} size="sm" />
          <span className="text-ink truncate">{profile?.display_name ?? user?.email}</span>
        </button>
      </div>
      {showSettings && <UserSettings onClose={() => setShowSettings(false)} />}
    </>
  );
}
