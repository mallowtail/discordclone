"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { Avatar } from "@/components/user/Avatar";
import { ProfileDialog } from "@/components/user/ProfileDialog";

export function UserPanel() {
  const router = useRouter();
  const { user, profile, signOut } = useAuth();
  const [showProfile, setShowProfile] = useState(false);

  async function onSignOut() {
    await signOut();
    router.replace("/login");
  }

  return (
    <>
      <div className="p-2 bg-surface-2 rounded-2xl flex items-center justify-between text-sm gap-2">
        <button onClick={() => setShowProfile(true)}
          className="flex items-center gap-2 min-w-0 hover:opacity-80" title="Edit profile">
          <Avatar url={profile?.avatar_url ?? null} name={profile?.display_name} size="sm" />
          <span className="text-ink truncate">{profile?.display_name ?? user?.email}</span>
        </button>
        <button onClick={onSignOut} className="text-muted hover:text-ink flex-none">Log out</button>
      </div>
      {showProfile && <ProfileDialog onClose={() => setShowProfile(false)} />}
    </>
  );
}
