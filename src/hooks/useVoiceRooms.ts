"use client";

import { useEffect, useState } from "react";
import type { VoiceOccupant } from "@/app/api/voice/rooms/route";
import { useVoice } from "@/components/providers/VoiceProvider";

/**
 * Who's in each voice channel of a server (channel id → people), from LiveKit via our server.
 * Polled every 8 seconds while shown, and right after you join or leave.
 */
export function useVoiceRooms(serverId: string, hasVoiceChannels: boolean) {
  const { status, room } = useVoice();
  const [rooms, setRooms] = useState<Record<string, VoiceOccupant[]>>({});

  useEffect(() => {
    if (!hasVoiceChannels) return;
    let active = true;
    const load = () =>
      fetch(`/api/voice/rooms?server=${serverId}`)
        .then((r) => (r.ok ? r.json() : { rooms: {} }))
        .then((j: { rooms: Record<string, VoiceOccupant[]> }) => { if (active) setRooms(j.rooms ?? {}); })
        .catch(() => {});
    load();
    const t = setInterval(load, 8000);
    return () => { active = false; clearInterval(t); };
  }, [serverId, hasVoiceChannels, status, room]);

  return hasVoiceChannels ? rooms : {};
}
