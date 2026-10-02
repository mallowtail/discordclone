"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { GearSix, Plus, CaretDown, CaretRight, Hash } from "@phosphor-icons/react";
import { createClient } from "@/lib/supabase/client";
import type { Server, Category, Channel } from "@/types/db";
import { CreateChannelDialog } from "@/components/servers/CreateChannelDialog";
import { CreateCategoryDialog } from "@/components/servers/CreateCategoryDialog";
import { ServerSettingsDialog } from "@/components/servers/ServerSettingsDialog";
import { InviteDialog } from "@/components/servers/InviteDialog";
import { UserPanel } from "@/components/user/UserPanel";
import { useServerPermissions } from "@/hooks/useServerPermissions";
import { useUnread } from "@/hooks/useUnread";
import { useDrawer } from "@/components/providers/DrawerProvider";

export function ServerSidebar({ serverId }: { serverId: string }) {
  const supabase = createClient();
  const pathname = usePathname();
  const [server, setServer] = useState<Server | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const [settings, setSettings] = useState(false);
  const [inviting, setInviting] = useState(false);
  const { has } = useServerPermissions(serverId);
  const { isUnread } = useUnread(serverId);
  const { closeDrawer } = useDrawer();
  const canManageChannels = has("manage_channels");
  const canManageServer = has("manage_server");
  const canManageRoles = has("manage_roles");

  // Extract active channel ID from pathname (e.g., /channels/abc123 -> abc123)
  // On /channels/first landing page, pathSegments[2] is "first" which matches no real id
  const pathSegments = pathname.split("/");
  const activeChannelId = pathSegments[1] === "channels" ? pathSegments[2] : null;

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


  function channelsIn(categoryId: string | null) {
    return channels.filter((c) => c.category_id === categoryId);
  }

  function renderChannelLink(channel: Channel, hasMargin = false) {
    const isActive = channel.id === activeChannelId;
    // The active channel is never shown as unread — you can't have unread messages in
    // what you're currently looking at. Because of that, the unread dot and the active
    // channel's left accent bar are mutually exclusive and never fight for the same spot.
    const unread = !isActive && isUnread(channel.id);
    return (
      <Link key={channel.id} href={`/channels/${channel.id}`}
        aria-current={isActive ? "page" : undefined}
        onClick={closeDrawer}
        className={`relative flex items-center gap-2 px-2 py-1 min-h-11 md:min-h-0 ${hasMargin ? "ml-2" : ""} rounded-row text-body ${
          isActive
            ? "bg-surface text-ink font-medium hover:bg-surface"
            : unread
            ? "hover:bg-surface/60 text-ink font-semibold"
            : "hover:bg-surface/60 text-muted hover:text-ink"
        }`}>
        {isActive && (
          <div
            className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-4 bg-accent rounded-full"
            aria-hidden="true"
          />
        )}
        {unread && (
          <div
            className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-ink rounded-pill"
            aria-hidden="true"
          />
        )}
        <Hash size={16} weight="bold" className={isActive ? "text-ink" : "text-muted"} aria-hidden="true" />
        {channel.name}
      </Link>
    );
  }

  const uncategorized = channelsIn(null);

  return (
    <aside className="w-[clamp(12.5rem,18vw,16.25rem)] bg-sidebar flex flex-col">
      <div className="flex items-center border-b border-line">
        <button
          onClick={() => setSettings(true)}
          className="flex-1 min-h-11 p-3 font-semibold text-ink tracking-tight flex items-center justify-between hover:bg-surface min-w-0"
        >
          <span className="truncate">{server?.name ?? "…"}</span>
          <span className="text-muted text-sm">
            <GearSix size={18} weight="regular" aria-label="Server settings" />
          </span>
        </button>
        <button
          onClick={() => setInviting(true)}
          title="Invite people"
          className="min-h-11 min-w-11 flex items-center justify-center px-3 py-3 text-muted hover:text-ink hover:bg-surface"
        >
          <Plus size={18} weight="bold" />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto p-2 text-muted">
        {uncategorized.map((c) => renderChannelLink(c, false))}
        {categories.map((cat) => (
          <div key={cat.id}>
            <button
              onClick={() => setCollapsed((p) => ({ ...p, [cat.id]: !p[cat.id] }))}
              className="w-full min-h-11 md:min-h-0 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted mt-3 mb-1 hover:text-ink"
            >
              <span>
                {collapsed[cat.id] ? (
                  <CaretRight size={12} weight="bold" />
                ) : (
                  <CaretDown size={12} weight="bold" />
                )}
              </span>{" "}
              {cat.name}
            </button>
            {!collapsed[cat.id] &&
              channelsIn(cat.id).map((c) => renderChannelLink(c, true))}
          </div>
        ))}
        {canManageChannels && (
          <div className="flex gap-2 mt-3 text-xs">
            <button onClick={() => setCreating(true)} className="min-h-11 md:min-h-0 flex items-center hover:text-ink">+ Channel</button>
            <button onClick={() => setAddingCategory(true)} className="min-h-11 md:min-h-0 flex items-center hover:text-ink">+ Category</button>
          </div>
        )}
      </nav>
      <div className="p-2">
        <UserPanel />
      </div>
      {creating && <CreateChannelDialog serverId={serverId} categories={categories} onClose={() => setCreating(false)} />}
      {addingCategory && (
        <CreateCategoryDialog
          serverId={serverId}
          position={categories.length}
          onClose={() => setAddingCategory(false)}
        />
      )}
      {settings && server && (
        <ServerSettingsDialog server={server} canManageServer={canManageServer} canManageRoles={canManageRoles} onSaved={load} onClose={() => setSettings(false)} />
      )}
      {inviting && server && (
        <InviteDialog server={server} isManager={canManageServer} onClose={() => setInviting(false)} />
      )}
    </aside>
  );
}
