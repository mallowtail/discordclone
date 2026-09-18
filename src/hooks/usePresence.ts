"use client";

import { usePresenceContext } from "@/components/providers/PresenceProvider";

/**
 * Who's online app-wide, backed by the single shared Supabase Realtime Presence channel owned
 * by `PresenceProvider` (mounted once in the authenticated app layout) — every call site reads
 * the same subscription instead of opening its own. No-ops (empty set) when there is no session,
 * and outside a `PresenceProvider` (the context's default value).
 */
export function usePresence(): { onlineIds: Set<string>; isOnline: (id: string) => boolean } {
  return usePresenceContext();
}
