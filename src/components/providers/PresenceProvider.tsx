"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";

const CHANNEL_NAME = "presence:online";
const EMPTY: Set<string> = new Set();

type Ctx = { onlineIds: Set<string>; isOnline: (id: string) => boolean };

const PresenceContext = createContext<Ctx>({ onlineIds: EMPTY, isOnline: () => false });

/**
 * Owns the single app-wide Supabase Realtime Presence channel (no DB table) so every consumer
 * (MembersPanel, DmSidebar, UserPanel, ProfileCard, FullProfileModal, ...) shares one WebSocket
 * subscription and one `track()` call instead of each opening its own. Mounted once in the
 * authenticated app layout; `usePresence()` just reads from this context.
 */
export function PresenceProvider({ children }: { children: React.ReactNode }) {
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
          channel.track({ user_id: user.id }).catch(() => {});
        }
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, user]);

  // While signed out, ignore any state left over from a previous session rather than clearing it
  // synchronously in the effect above (which the set-state-in-effect lint rule flags).
  const ids = user ? onlineIds : EMPTY;
  const isOnline = useCallback((id: string) => ids.has(id), [ids]);

  return (
    <PresenceContext.Provider value={{ onlineIds: ids, isOnline }}>
      {children}
    </PresenceContext.Provider>
  );
}

export const usePresenceContext = () => useContext(PresenceContext);
