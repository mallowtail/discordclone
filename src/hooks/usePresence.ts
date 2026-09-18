"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";

const CHANNEL_NAME = "presence:online";
const EMPTY: Set<string> = new Set();

/**
 * Tracks who's online app-wide via a single Supabase Realtime Presence channel (no DB table).
 * The signed-in user tracks their own id; every client's presence state is synced into
 * `onlineIds`. No-ops (returns an always-empty set) when there is no session.
 */
export function usePresence(): { onlineIds: Set<string>; isOnline: (id: string) => boolean } {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const [onlineIds, setOnlineIds] = useState<Set<string>>(EMPTY);

  useEffect(() => {
    if (!user) return;
    const channel = supabase.channel(CHANNEL_NAME, { config: { presence: { key: user.id } } });
    channel
      .on("presence", { event: "sync" }, () => {
        setOnlineIds(new Set(Object.keys(channel.presenceState())));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          channel.track({ user_id: user.id });
        }
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, user]);

  // While signed out, ignore any state left over from a previous session rather than clearing it
  // synchronously in the effect above (which the set-state-in-effect lint rule flags).
  const ids = user ? onlineIds : EMPTY;

  return {
    onlineIds: ids,
    isOnline: (id: string) => ids.has(id),
  };
}
