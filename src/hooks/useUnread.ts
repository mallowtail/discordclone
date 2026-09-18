"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { hasUnread } from "@/lib/unread";
import type { Message } from "@/types/db";

/**
 * Per-server unread tracking: which of this server's channels have messages the
 * signed-in user hasn't read yet.
 *
 * The channel currently open (derived from the URL, same rule ServerSidebar uses) is
 * never reported as unread — you can't have unread messages in the thing you're
 * looking at. That exclusion is applied at read time (`isUnread`/`hasAnyUnread`) and
 * in the realtime handler, not by refetching on every navigation.
 *
 * If any of the underlying queries fail (most notably: the `channel_reads` table not
 * existing yet, since its migration ships separately from this code), this hook
 * degrades quietly to "nothing unread" rather than throwing, so a missing table can
 * never break the sidebar or rail.
 */
export function useUnread(serverId: string | null): {
  isUnread: (channelId: string) => boolean;
  hasAnyUnread: boolean;
  markRead: (channelId: string) => void;
} {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const pathname = usePathname();
  const [unread, setUnread] = useState<Record<string, boolean>>({});
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

    async function load() {
      if (!serverId || !user) {
        if (active) {
          setUnread({});
          setLastReadAt({});
        }
        return;
      }
      const uid = user.id;
      try {
        const { data: channels, error: chErr } = await supabase
          .from("channels")
          .select("id")
          .eq("server_id", serverId);
        if (chErr || !channels || channels.length === 0) {
          if (active) {
            setUnread({});
            setLastReadAt({});
          }
          return;
        }
        const channelIds = channels.map((c) => c.id as string);

        const { data: reads, error: readsErr } = await supabase
          .from("channel_reads")
          .select("channel_id, last_read_at")
          .eq("user_id", uid)
          .in("channel_id", channelIds);
        // A missing/erroring channel_reads table must not break the sidebar: treat it
        // as "nothing has ever been read" rather than failing.
        const readsMap: Record<string, string | null> = {};
        if (!readsErr) {
          for (const r of reads ?? []) {
            readsMap[r.channel_id as string] = r.last_read_at as string;
          }
        }

        // Recent messages per channel, newest first, capped — enough to tell whether
        // each channel has anything unread without pulling full history.
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
          setLastReadAt(readsMap);
          setUnread(unreadMap);
        }
      } catch {
        // Degrade quietly: a missing table, network hiccup, etc. means "nothing unread".
        if (active) {
          setUnread({});
          setLastReadAt({});
        }
      }
    }
    load();

    return () => {
      active = false;
    };
  }, [supabase, serverId, user]);

  useEffect(() => {
    if (!serverId || !user) return;
    const channel = supabase
      .channel(`unread:${serverId}:${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const row = payload.new as Message;
          const channelId = row.channel_id;
          if (!channelId) return;
          setUnread((prev) => {
            // Only react to channels we're already tracking for this server, and never
            // flag the channel currently open.
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
  }, [supabase, serverId, user, activeChannelId]);

  const isUnread = useCallback(
    (channelId: string) => channelId !== activeChannelId && unread[channelId] === true,
    [unread, activeChannelId]
  );

  const hasAnyUnread = useMemo(
    () => Object.entries(unread).some(([id, v]) => v && id !== activeChannelId),
    [unread, activeChannelId]
  );

  const markRead = useCallback(
    (channelId: string) => {
      if (!user) return;
      const now = new Date().toISOString();
      setUnread((prev) => (prev[channelId] ? { ...prev, [channelId]: false } : prev));
      setLastReadAt((prev) => ({ ...prev, [channelId]: now }));
      void supabase
        .from("channel_reads")
        .upsert({ user_id: user.id, channel_id: channelId, last_read_at: now }, { onConflict: "user_id,channel_id" });
    },
    [supabase, user]
  );

  return { isUnread, hasAnyUnread, markRead };
}
