"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import type { Profile } from "@/types/db";
import { NewDmDialog } from "@/components/dms/NewDmDialog";
import { Avatar } from "@/components/user/Avatar";
import { UserPanel } from "@/components/user/UserPanel";
import { useProfilePopover } from "@/components/providers/ProfilePopoverProvider";

export function DmSidebar() {
  const supabase = createClient();
  const { user } = useAuth();
  const { open } = useProfilePopover();
  const [dms, setDms] = useState<{ id: string; other: Profile }[]>([]);

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

  return (
    <aside className="w-60 bg-sidebar flex flex-col">
      <div className="p-3 font-semibold text-ink tracking-tight border-b border-line">Direct Messages</div>
      <nav className="flex-1 overflow-y-auto p-2 text-muted">
        <div className="flex items-center justify-between text-xs uppercase mt-2 mb-1">
          Direct Messages <NewDmDialog />
        </div>
        {dms.map((d) => (
          <Link key={d.id} href={`/dms/${d.id}`}
            className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface hover:text-ink">
            <span
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (!d.other) return; open(d.other.id, e.currentTarget.getBoundingClientRect()); }}
              className="flex-none"
            >
              <Avatar url={d.other?.avatar_url ?? null} name={d.other?.display_name} size="sm" />
            </span>
            {d.other?.display_name ?? "Unknown"}
          </Link>
        ))}
      </nav>
      <UserPanel />
    </aside>
  );
}
