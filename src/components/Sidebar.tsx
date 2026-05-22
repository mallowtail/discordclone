"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import type { Channel, Profile } from "@/types/db";
import { NewDmDialog } from "@/components/NewDmDialog";

export function Sidebar() {
  const supabase = createClient();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [dms, setDms] = useState<{ id: string; other: Profile }[]>([]);

  useEffect(() => {
    supabase.from("channels").select("*").order("position")
      .then(({ data }) => setChannels(data ?? []));
  }, [supabase]);

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
    <aside className="w-60 bg-[#2b2d31] flex flex-col">
      <div className="p-3 font-bold text-white border-b border-black/30">🏫 Our Server</div>
      <nav className="flex-1 overflow-y-auto p-2 text-[#949ba4]">
        <div className="text-xs uppercase mt-2 mb-1">Text Channels</div>
        {channels.map((c) => (
          <Link key={c.id} href={`/channels/${c.name}`}
            className="block px-2 py-1 rounded hover:bg-[#404249] hover:text-white">
            # {c.name}
          </Link>
        ))}
        <div className="flex items-center justify-between text-xs uppercase mt-4 mb-1">
          Direct Messages <NewDmDialog />
        </div>
        {dms.map((d) => (
          <Link key={d.id} href={`/dms/${d.id}`}
            className="block px-2 py-1 rounded hover:bg-[#404249] hover:text-white">
            ● {d.other?.display_name ?? "Unknown"}
          </Link>
        ))}
      </nav>
      <div className="p-2 bg-[#232428] flex items-center justify-between text-sm">
        <span className="text-white truncate">🟢 {user?.email}</span>
        <button onClick={onSignOut} className="text-[#949ba4] hover:text-white">Log out</button>
      </div>
    </aside>
  );
}
