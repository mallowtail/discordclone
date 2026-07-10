"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Server, Category, Channel } from "@/types/db";
import { CreateChannelDialog } from "@/components/servers/CreateChannelDialog";
import { ServerSettingsDialog } from "@/components/servers/ServerSettingsDialog";
import { InviteDialog } from "@/components/servers/InviteDialog";
import { useServerRole } from "@/hooks/useServerRole";

export function ServerSidebar({ serverId }: { serverId: string }) {
  const supabase = createClient();
  const [server, setServer] = useState<Server | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);
  const [settings, setSettings] = useState(false);
  const [inviting, setInviting] = useState(false);
  const { isManager } = useServerRole(serverId);

  const load = useCallback(async () => {
    const [{ data: s }, { data: cats }, { data: chs }] = await Promise.all([
      supabase.from("servers").select("*").eq("id", serverId).single(),
      supabase.from("categories").select("*").eq("server_id", serverId).order("position"),
      supabase.from("channels").select("*").eq("server_id", serverId).order("position"),
    ]);
    setServer((s as Server) ?? null);
    setCategories((cats as Category[]) ?? []);
    setChannels((chs as Channel[]) ?? []);
  }, [supabase, serverId]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`server-sidebar:${serverId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "channels", filter: `server_id=eq.${serverId}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "categories", filter: `server_id=eq.${serverId}` }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, serverId, load]);

  async function addCategory() {
    const name = prompt("Category name")?.trim();
    if (!name) return;
    await supabase.from("categories").insert({ server_id: serverId, name, position: categories.length });
  }

  function channelsIn(categoryId: string | null) {
    return channels.filter((c) => c.category_id === categoryId);
  }

  const uncategorized = channelsIn(null);

  return (
    <aside className="w-60 bg-sidebar flex flex-col">
      <div className="flex items-center border-b border-line">
        <button
          onClick={() => setSettings(true)}
          className="flex-1 p-3 font-bold text-ink flex items-center justify-between hover:bg-surface min-w-0"
        >
          <span className="truncate">{server?.name ?? "…"}</span>
          <span className="text-muted text-sm">⚙</span>
        </button>
        <button
          onClick={() => setInviting(true)}
          title="Invite people"
          className="px-3 py-3 text-muted hover:text-ink hover:bg-surface"
        >
          ＋
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto p-2 text-muted">
        {uncategorized.map((c) => (
          <Link key={c.id} href={`/channels/${c.id}`}
            className="block px-2 py-1 rounded hover:bg-surface hover:text-ink"># {c.name}</Link>
        ))}
        {categories.map((cat) => (
          <div key={cat.id}>
            <button
              onClick={() => setCollapsed((p) => ({ ...p, [cat.id]: !p[cat.id] }))}
              className="w-full flex items-center gap-1 text-[10px] uppercase tracking-wide mt-3 mb-1 hover:text-ink"
            >
              <span>{collapsed[cat.id] ? "▸" : "▾"}</span> {cat.name}
            </button>
            {!collapsed[cat.id] &&
              channelsIn(cat.id).map((c) => (
                <Link key={c.id} href={`/channels/${c.id}`}
                  className="block px-2 py-1 ml-2 rounded hover:bg-surface hover:text-ink"># {c.name}</Link>
              ))}
          </div>
        ))}
        {isManager && (
          <div className="flex gap-2 mt-3 text-xs">
            <button onClick={() => setCreating(true)} className="hover:text-ink">+ Channel</button>
            <button onClick={addCategory} className="hover:text-ink">+ Category</button>
          </div>
        )}
      </nav>
      {creating && <CreateChannelDialog serverId={serverId} categories={categories} onClose={() => setCreating(false)} />}
      {settings && server && (
        <ServerSettingsDialog server={server} isManager={isManager} onSaved={load} onClose={() => setSettings(false)} />
      )}
      {inviting && server && (
        <InviteDialog server={server} isManager={isManager} onClose={() => setInviting(false)} />
      )}
    </aside>
  );
}
