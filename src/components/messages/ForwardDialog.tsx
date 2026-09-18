"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { useServers } from "@/hooks/useServers";
import { buildForwardSnapshot } from "@/lib/forward";
import { Modal } from "@/components/ui/Modal";
import type { Channel, Message } from "@/types/db";
import { Hash, At, Check, MagnifyingGlass } from "@phosphor-icons/react";

type Dest = { key: string; kind: "channel" | "dm"; id: string; label: string; group: string };

export function ForwardDialog({ message, onClose }: { message: Message; onClose: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const { servers } = useServers();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [dms, setDms] = useState<{ id: string; label: string }[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const serverIdsKey = servers.map((s) => s.id).join(",");
  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      const serverIds = serverIdsKey ? serverIdsKey.split(",") : [];
      if (serverIds.length) {
        const { data } = await supabase.from("channels").select("*").in("server_id", serverIds).order("position");
        if (active) setChannels((data as Channel[]) ?? []);
      } else if (active) setChannels([]);
      const { data: memberships } = await supabase
        .from("conversation_members").select("conversation_id").eq("user_id", user.id);
      const convIds = (memberships ?? []).map((m) => m.conversation_id);
      if (convIds.length) {
        const { data: others } = await supabase
          .from("conversation_members").select("conversation_id, profiles(*)")
          .in("conversation_id", convIds).neq("user_id", user.id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (active) setDms(((others ?? []) as any[]).map((o) => ({ id: o.conversation_id, label: o.profiles?.display_name ?? "Direct message" })));
      } else if (active) setDms([]);
    })();
    return () => { active = false; };
  }, [supabase, user, serverIdsKey]);

  const serverName = (id: string) => servers.find((s) => s.id === id)?.name ?? "Server";
  const dests: Dest[] = [
    ...channels.map((c) => ({ key: `channel:${c.id}`, kind: "channel" as const, id: c.id, label: `#${c.name}`, group: serverName(c.server_id) })),
    ...dms.map((d) => ({ key: `dm:${d.id}`, kind: "dm" as const, id: d.id, label: d.label, group: "Direct Messages" })),
  ];
  const q = search.trim().toLowerCase();
  const filtered = q ? dests.filter((d) => d.label.toLowerCase().includes(q) || d.group.toLowerCase().includes(q)) : dests;
  const groups = filtered.reduce<Record<string, Dest[]>>((acc, d) => { (acc[d.group] ??= []).push(d); return acc; }, {});

  const sourceLabel = message.channel_id
    ? (() => { const c = channels.find((ch) => ch.id === message.channel_id); return c ? `#${c.name}` : "a channel"; })()
    : "a direct message";

  function toggle(key: string) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }

  async function forward() {
    if (selected.size === 0 || !user) return;
    setBusy(true); setError(null);
    const snapshot = buildForwardSnapshot(message, sourceLabel);
    const rows = [...selected].map((key) => {
      const [kind, id] = key.split(":");
      return {
        author_id: user.id,
        content: comment.trim(),
        forward_snapshot: snapshot,
        channel_id: kind === "channel" ? id : null,
        conversation_id: kind === "dm" ? id : null,
      };
    });
    const { error: err } = await supabase.from("messages").insert(rows);
    setBusy(false);
    if (err) return setError("Couldn't forward — try again");
    onClose();
  }

  return (
    <Modal onClose={onClose} title="Forward message" size="sm">
      <div className="flex h-full flex-col">
        <div className="px-4 pt-3 pb-2">
          <div className="relative">
            <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              autoFocus value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search channels and DMs"
              className="w-full pl-9 pr-3 py-2 rounded-control bg-surface-2 text-ink text-body outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-1">
          {Object.keys(groups).length === 0 && <p className="text-muted text-body py-2">No destinations found.</p>}
          {Object.entries(groups).map(([group, rows]) => (
            <div key={group} className="mb-2">
              <div className="text-micro font-semibold uppercase tracking-wider text-muted mt-2 mb-1">{group}</div>
              {rows.map((d) => {
                const on = selected.has(d.key);
                return (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => toggle(d.key)}
                    aria-pressed={on}
                    className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-row text-left transition ${
                      on ? "bg-accent/15" : "hover:bg-surface-2"
                    }`}
                  >
                    <span className="w-8 h-8 flex-none rounded-row bg-surface-2 text-muted flex items-center justify-center">
                      {d.kind === "channel" ? <Hash size={16} weight="bold" /> : <At size={16} weight="bold" />}
                    </span>
                    <span className={`flex-1 min-w-0 text-body truncate ${on ? "text-ink font-medium" : "text-ink"}`}>{d.label}</span>
                    <span
                      className={`w-5 h-5 flex-none rounded-pill flex items-center justify-center border transition ${
                        on ? "bg-accent border-accent text-white" : "border-line text-transparent"
                      }`}
                    >
                      <Check size={12} weight="bold" />
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="p-4 pt-2 border-t border-line">
          {error && <p className="text-danger text-body mb-2">{error}</p>}
          <input
            value={comment} onChange={(e) => setComment(e.target.value)}
            placeholder="Add a comment — optional"
            className="w-full p-2 rounded-control bg-surface-2 text-ink text-body mb-2"
          />
          <button
            onClick={forward} disabled={busy || selected.size === 0}
            className="w-full bg-accent hover:bg-accent-strong text-white font-medium rounded-control p-2 disabled:opacity-50"
          >
            {busy ? "Forwarding…" : selected.size ? `Forward to ${selected.size}` : "Forward"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
