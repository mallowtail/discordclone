"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Room, RoomEvent, Track, type Participant, type RemoteTrack } from "livekit-client";
import { useAuth } from "@/components/providers/AuthProvider";

export type VoiceParticipant = { id: string; name: string; speaking: boolean; muted: boolean; isLocal: boolean };

type Status = "idle" | "connecting" | "connected";

type Ctx = {
  status: Status;
  /** LiveKit room name (see lib/voice/rooms) of the room we're in or joining. */
  room: string | null;
  /** What to call it in the voice bar ("#hangout", "Sam"), and where clicking it goes. */
  label: string | null;
  href: string | null;
  participants: VoiceParticipant[];
  selfMuted: boolean;
  deafened: boolean;
  /** False when the server only allows listening (e.g. timed out). */
  canSpeak: boolean;
  error: string | null;
  join: (room: string, label: string, href: string) => Promise<void>;
  leave: () => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleDeafen: () => Promise<void>;
};

const VoiceContext = createContext<Ctx>({
  status: "idle", room: null, label: null, href: null, participants: [], selfMuted: false, deafened: false,
  canSpeak: true, error: null, join: async () => {}, leave: async () => {}, toggleMute: async () => {}, toggleDeafen: async () => {},
});

/** Mute or unmute every remote audio element (deafen). */
function setAllMuted(els: Set<HTMLMediaElement>, muted: boolean) {
  els.forEach((el) => { el.muted = muted; });
}

function snapshot(room: Room): VoiceParticipant[] {
  const speaking = new Set(room.activeSpeakers.map((p) => p.identity));
  const one = (p: Participant, isLocal: boolean): VoiceParticipant => ({
    id: p.identity,
    name: p.name || "Someone",
    speaking: speaking.has(p.identity),
    muted: !p.isMicrophoneEnabled,
    isLocal,
  });
  return [one(room.localParticipant, true), ...[...room.remoteParticipants.values()].map((p) => one(p, false))];
}

/**
 * The app's single voice connection (LiveKit). It lives above the pages, so you stay in a call while
 * moving between channels and servers, like Discord. Remote audio plays through hidden <audio>
 * elements; deafening mutes them all (and your mic).
 */
export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const roomRef = useRef<Room | null>(null);
  const audioEls = useRef(new Set<HTMLMediaElement>());
  const deafRef = useRef(false);
  const mutedBeforeDeafen = useRef(false);
  const [status, setStatus] = useState<Status>("idle");
  const [roomName, setRoomName] = useState<string | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [href, setHref] = useState<string | null>(null);
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [selfMuted, setSelfMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [canSpeak, setCanSpeak] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    for (const el of audioEls.current) el.remove();
    audioEls.current.clear();
    roomRef.current = null;
    setStatus("idle");
    setRoomName(null);
    setLabel(null);
    setHref(null);
    setParticipants([]);
  }, []);

  const leave = useCallback(async () => {
    const room = roomRef.current;
    reset();
    await room?.disconnect();
  }, [reset]);

  const join = useCallback(async (name: string, newLabel: string, newHref: string) => {
    if (roomRef.current?.name === name) return;
    await leave();
    setError(null);
    setStatus("connecting");
    setRoomName(name);
    setLabel(newLabel);
    setHref(newHref);

    const res = await fetch("/api/voice/token", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ room: name }),
    });
    const body = (await res.json().catch(() => ({}))) as { token?: string; canSpeak?: boolean; error?: string };
    const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
    if (!res.ok || !body.token || !url) {
      reset();
      setError(body.error ?? "Couldn't join voice — try again");
      return;
    }

    const room = new Room({ adaptiveStream: false, dynacast: false });
    roomRef.current = room;
    const refresh = () => { if (roomRef.current === room) setParticipants(snapshot(room)); };
    room
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind !== Track.Kind.Audio) return;
        const el = track.attach();
        el.muted = deafRef.current;
        el.style.display = "none";
        document.body.appendChild(el);
        audioEls.current.add(el);
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        for (const el of track.detach()) {
          el.remove();
          audioEls.current.delete(el);
        }
      })
      .on(RoomEvent.ParticipantConnected, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.ActiveSpeakersChanged, refresh)
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.LocalTrackPublished, refresh)
      .on(RoomEvent.Disconnected, () => { if (roomRef.current === room) reset(); });

    try {
      await room.connect(url, body.token, { autoSubscribe: true });
      await room.startAudio().catch(() => {}); // called inside the click, so browsers allow sound
    } catch {
      reset();
      setError("Couldn't connect to voice — check your internet and try again");
      return;
    }
    if (roomRef.current !== room) return; // left (or switched) while connecting
    setCanSpeak(body.canSpeak !== false);
    if (body.canSpeak !== false && !deafRef.current) {
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
        setSelfMuted(false);
      } catch {
        setSelfMuted(true);
        setError("Your microphone is blocked — allow it in the browser to talk. You can still listen.");
      }
    } else {
      setSelfMuted(true);
    }
    setStatus("connected");
    refresh();
  }, [leave, reset]);

  const toggleMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room || !canSpeak) return;
    if (deafRef.current) {
      // Unmuting while deafened undeafens too (like Discord).
      deafRef.current = false;
      setDeafened(false);
      setAllMuted(audioEls.current, false);
    }
    const next = !selfMuted;
    try {
      await room.localParticipant.setMicrophoneEnabled(!next);
      setSelfMuted(next);
      setError(null);
    } catch {
      setError("Your microphone is blocked — allow it in the browser to talk.");
    }
    setParticipants(snapshot(room));
  }, [selfMuted, canSpeak]);

  const toggleDeafen = useCallback(async () => {
    const room = roomRef.current;
    const next = !deafRef.current;
    deafRef.current = next;
    setDeafened(next);
    setAllMuted(audioEls.current, next);
    if (!room || !canSpeak) return;
    if (next) {
      mutedBeforeDeafen.current = selfMuted;
      await room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
      setSelfMuted(true);
    } else if (!mutedBeforeDeafen.current) {
      await room.localParticipant.setMicrophoneEnabled(true).catch(() => {});
      setSelfMuted(false);
    }
    setParticipants(snapshot(room));
  }, [selfMuted, canSpeak]);

  // Signing out (or a different account) ends the call; closing the tab disconnects cleanly.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- signing out must end the call
    if (!user) void leave();
  }, [user, leave]);
  useEffect(() => {
    const onUnload = () => { void roomRef.current?.disconnect(); };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  const value = useMemo<Ctx>(() => ({
    status, room: roomName, label, href, participants, selfMuted, deafened, canSpeak, error,
    join, leave, toggleMute, toggleDeafen,
  }), [status, roomName, label, href, participants, selfMuted, deafened, canSpeak, error, join, leave, toggleMute, toggleDeafen]);

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export const useVoice = () => useContext(VoiceContext);
