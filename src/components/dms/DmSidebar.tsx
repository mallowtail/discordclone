"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import type { Profile } from "@/types/db";
import { NewDmDialog } from "@/components/dms/NewDmDialog";
import { Avatar } from "@/components/user/Avatar";
import { ProfileDialog } from "@/components/user/ProfileDialog";

export function DmSidebar() {
  const supabase = createClient();
  const router = useRouter();
  const { user, profile, signOut } = useAuth();
  const [dms, setDms] = useState<{ id: string; other: Profile }[]>([]);
  const [showProfile, setShowProfile] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: memberships } = await supabase
        .from("conversation_members")
        .select("conversation_id")
        .eq("user_id", user.id);
      const convIds = (memberships ?? []).map((m) => m.conversation_id);
      if (convIds.length === 0) return setDms([]);
      const { data: others } = await supabase
        .from("conversation_members")
        .select("conversation_id, profiles(*)")
        .in("conversation_id", convIds)
        .neq("user_id", user.id);
      setDms(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (others ?? []).map((o: any) => ({ id: o.conversation_id, other: o.profiles }))
      );
    })();
  }, [supabase, user]);

  async function onSignOut() {
    await signOut();
    router.replace("/login");
  }

  return (
    <aside className="w-60 bg-sidebar flex flex-col">
      <div className="p-3 font-bold text-ink border-b border-line">Direct Messages</div>
      <nav className="flex-1 overflow-y-auto p-2 text-muted">
        <div className="flex items-center justify-between text-xs uppercase mt-2 mb-1">
          Direct Messages <NewDmDialog />
        </div>
        {dms.map((d) => (
          <Link key={d.id} href={`/dms/${d.id}`}
            className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface hover:text-ink">
            <Avatar url={d.other?.avatar_url ?? null} name={d.other?.display_name} size="sm" />
            {d.other?.display_name ?? "Unknown"}
          </Link>
        ))}
      </nav>
      <div className="p-2 bg-surface-2 rounded-xl flex items-center justify-between text-sm gap-2">
        <button onClick={() => setShowProfile(true)}
          className="flex items-center gap-2 min-w-0 hover:opacity-80" title="Edit profile">
          <Avatar url={profile?.avatar_url ?? null} name={profile?.display_name} size="sm" />
          <span className="text-ink truncate">{profile?.display_name ?? user?.email}</span>
        </button>
        <button onClick={onSignOut} className="text-muted hover:text-ink flex-none">Log out</button>
      </div>
      {showProfile && <ProfileDialog onClose={() => setShowProfile(false)} />}
    </aside>
  );
}
