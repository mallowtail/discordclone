"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { hasUnread } from "@/lib/unread";
import type { Message } from "@/types/db";

type UnreadCtx = {
  activeChannelId: string | null;
  unreadByChannel: Record<string, boolean>;
  channelServer: Record<string, string>;
  markRead: (channelId: string) => void;
};

const EMPTY_BOOL: Record<string, boolean> = {};
const EMPTY_STR: Record<string, string> = {};

const UnreadContext = createContext<UnreadCtx>({
  activeChannelId: null,
  unreadByChannel: EMPTY_BOOL,
  channelServer: EMPTY_STR,
  markRead: () => {},
});

/**
 * Owns ALL unread tracking for the signed-in user in one place: one `channels` load, one
 * `channel_reads` load, one per-channel recent-messages fan-out, and one realtime
 * subscription — shared by every consumer (ServerSidebar, every ServerRailButton,
 * ChannelView) instead of each running its own copy. Mirrors PresenceProvider's precedent
 * for the same reason: without this, `useUnread(serverId)` mounting independently in three
 * places would multiply query and socket volume by consumer count (and by server count
 * across the rail). Mounted once in the authenticated app layout; `useUnread()` just reads
 * from this context.
 *
 * A single global provider is the right shape here even though the rail needs unread
 * across ALL servers while the sidebar/channel page need one server's slice: the
 * underlying data (channel_reads + recent messages) is per-channel, not per-server, and
 * "which server is channel X in" is a cheap static lookup (`channelServer`) computed once
 * from the same `channels` query. Splitting into N per-server providers would still need to
 * enumerate every server up front to mount them, buying nothing.
 *
 * Degrades quietly to "nothing unread" if any query errors — most notably `channel_reads`
 * not existing yet, since its migration ships separately from this code. Both the
 * `channels` and `channel_reads` error branches below bail out to an empty map; falling
 * through on a `channel_reads` error would leave every channel's `lastReadAt` implicitly
 * null, which `unread.ts` defines as "everything unread" — the opposite of quiet
 * degradation.
 */
export function UnreadProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const pathname = usePathname();
  const [unreadByChannel, setUnreadByChannel] = useState<Record<string, boolean>>({});
  const [channelServer, setChannelServer] = useState<Record<string, string>>({});
  const [lastReadAt, setLastReadAt] = useState<Record<string, string | null>>({});
  // Mirrors `lastReadAt` for the realtime handler below, so that handler doesn't need
  // `lastReadAt` in its effect deps (which would tear down and resubscribe the channel
  // on every read/markRead update).
  const lastReadAtRef = useRef(lastReadAt);

  const pathSegments = pathname.split("/");
  const activeChannelId = pathSegments[1] === "channels" ? pathSegments[2] : null;

  useEffect(() => {
    lastReadAtRef.current = lastReadAt;
  }, [lastReadAt]);

  useEffect(() => {
    let active = true;

    function reset() {
      if (!active) return;
      setUnreadByChannel({});
      setChannelServer({});
      setLastReadAt({});
    }

    async function load() {
      if (!user) {
        reset();
        return;
      }
      const uid = user.id;
      try {
        const { data: channels, error: chErr } = await supabase.from("channels").select("id, server_id");
        if (chErr || !channels || channels.length === 0) {
          reset();
          return;
        }
        const channelIds = channels.map((c) => c.id as string);
        const serverMap: Record<string, string> = {};
        for (const c of channels) serverMap[c.id as string] = c.server_id as string;

        const { data: reads, error: readsErr } = await supabase
          .from("channel_reads")
          .select("channel_id, last_read_at")
          .eq("user_id", uid);
        if (readsErr) {
          // A missing/erroring channel_reads table (e.g. before this migration is applied)
          // must not be treated as "nothing has ever been read" and left to fall through —
          // that produces a null lastReadAt per channel, which unread.ts defines as
          // EVERYTHING unread. Bail the same way the channels-query error branch does.
          reset();
          return;
        }
        const readsMap: Record<string, string | null> = {};
        for (const r of reads ?? []) {
          readsMap[r.channel_id as string] = r.last_read_at as string;
        }

        // Recent messages per channel, newest first, capped — enough to tell whether each
        // channel has anything unread without pulling full history.
        const results = await Promise.all(
          channelIds.map((id) =>
            supabase
              .from("messages")
              .select("*")
              .eq("channel_id", id)
              .order("created_at", { ascending: false })
              .limit(20)
          )
        );
        const unreadMap: Record<string, boolean> = {};
        channelIds.forEach((id, i) => {
          const { data, error } = results[i];
          unreadMap[id] = !error && data ? hasUnread(data as Message[], readsMap[id] ?? null, uid) : false;
        });

        if (active) {
          setChannelServer(serverMap);
          setLastReadAt(readsMap);
          setUnreadByChannel(unreadMap);
        }
      } catch {
        // Degrade quietly: network hiccup, unexpected throw, etc. means "nothing unread".
        reset();
      }
    }
    load();

    return () => {
      active = false;
    };
  }, [supabase, user]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`unread:${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const row = payload.new as Message;
          const channelId = row.channel_id;
          if (!channelId) return;
          setUnreadByChannel((prev) => {
            // Only react to channels we're already tracking, and never flag the channel
            // currently open.
            if (!(channelId in prev)) return prev;
            if (channelId === activeChannelId) return prev;
            if (!hasUnread([row], lastReadAtRef.current[channelId] ?? null, user.id)) return prev;
            return { ...prev, [channelId]: true };
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, user, activeChannelId]);

  const markRead = useCallback(
    (channelId: string) => {
      if (!user) return;
      const now = new Date().toISOString();
      setUnreadByChannel((prev) => (prev[channelId] ? { ...prev, [channelId]: false } : prev));
      setLastReadAt((prev) => ({ ...prev, [channelId]: now }));
      void supabase
        .from("channel_reads")
        .upsert({ user_id: user.id, channel_id: channelId, last_read_at: now }, { onConflict: "user_id,channel_id" });
    },
    [supabase, user]
  );

  const value = useMemo(
    () => ({ activeChannelId, unreadByChannel, channelServer, markRead }),
    [activeChannelId, unreadByChannel, channelServer, markRead]
  );

  return <UnreadContext.Provider value={value}>{children}</UnreadContext.Provider>;
}

export const useUnreadContext = () => useContext(UnreadContext);
