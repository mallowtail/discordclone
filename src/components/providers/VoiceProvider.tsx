"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Room, RoomEvent, Track, type Participant, type RemoteTrack } from "livekit-client";
import { useAuth } from "@/components/providers/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import { parseRoom } from "@/lib/voice/rooms";
import { DEFAULT_SETTINGS, STORAGE_KEY, parseVoiceSettings, type VoiceSettings } from "@/lib/voice/settings";
import { createMicGate, type MicGate } from "@/components/voice/micGate";

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
  /** Settings → Voice (saved in this browser). Changes apply to a call in progress too. */
  settings: VoiceSettings;
  updateSettings: (patch: Partial<VoiceSettings>) => void;
  /** Push to talk: the key is held right now. */
  pttHeld: boolean;
};

const VoiceContext = createContext<Ctx>({
  status: "idle", room: null, label: null, href: null, participants: [], selfMuted: false, deafened: false,
  canSpeak: true, error: null, join: async () => {}, leave: async () => {}, toggleMute: async () => {}, toggleDeafen: async () => {},
  settings: DEFAULT_SETTINGS, updateSettings: () => {}, pttHeld: false,
});

/** Mute or unmute every remote audio element (deafen). */
function setAllMuted(els: Set<HTMLMediaElement>, muted: boolean) {
  els.forEach((el) => { el.muted = muted; });
}

function loadSettings(): VoiceSettings {
  try {
    return typeof window === "undefined" ? DEFAULT_SETTINGS : parseVoiceSettings(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Is the keyboard focus in something you type into (so a push-to-talk key should still type)? */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
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
 * Turns the mic on, then routes it through the voice-activity / push-to-talk gate. The gate runs in
 * our own audio context (LiveKit only makes one in a mode we don't use). If this browser can't run
 * the gate, the plain mic stays on (always sending) rather than voice not working at all.
 */
async function enableMic(room: Room, gate: MicGate | null, ctx: AudioContext | null) {
  await room.localParticipant.setMicrophoneEnabled(true);
  const track = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
  if (!gate || !ctx || !track || track.getProcessor()) return;
  try {
    await track.setAudioContext(ctx);
    await track.setProcessor(gate.processor);
  } catch {
    // keep the plain mic
  }
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
  const [settings, setSettings] = useState<VoiceSettings>(loadSettings);
  const settingsRef = useRef(settings);
  const gateRef = useRef<MicGate | null>(null);
  const gateCtxRef = useRef<AudioContext | null>(null);
  const [pttHeld, setPttHeld] = useState(false);

  const reset = useCallback(() => {
    for (const el of audioEls.current) el.remove();
    audioEls.current.clear();
    roomRef.current = null;
    gateRef.current = null;
    void gateCtxRef.current?.close().catch(() => {});
    gateCtxRef.current = null;
    setPttHeld(false);
    setStatus("idle");
    setRoomName(null);
    setLabel(null);
    setHref(null);
    setParticipants([]);
  }, []);

  const leave = useCallback(async () => {
    const room = roomRef.current;
    // Last one out of a DM / group call marks the call over (so nobody gets "Join call" for an
    // empty room).
    const ref = room ? parseRoom(room.name) : null;
    const lastOut = !!room && ref?.type === "conversation" && room.remoteParticipants.size === 0;
    reset();
    await room?.disconnect();
    if (lastOut && ref) await createClient().rpc("end_call", { conv: ref.id });
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

    const s = settingsRef.current;
    const room = new Room({
      adaptiveStream: false, dynacast: false,
      audioCaptureDefaults: s.inputId ? { deviceId: s.inputId } : undefined,
      audioOutput: s.outputId ? { deviceId: s.outputId } : undefined,
    });
    gateRef.current = createMicGate(s.mode, s.threshold);
    try {
      gateCtxRef.current = new AudioContext(); // made inside the click, so it's allowed to run
    } catch {
      gateCtxRef.current = null;
    }
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
        await enableMic(room, gateRef.current, gateCtxRef.current);
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
      if (next) await room.localParticipant.setMicrophoneEnabled(false);
      else await enableMic(room, gateRef.current, gateCtxRef.current);
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
      await enableMic(room, gateRef.current, gateCtxRef.current).catch(() => {});
      setSelfMuted(false);
    }
    setParticipants(snapshot(room));
  }, [selfMuted, canSpeak]);

  const updateSettings = useCallback((patch: Partial<VoiceSettings>) => {
    const prev = settingsRef.current;
    const next = { ...prev, ...patch };
    settingsRef.current = next;
    setSettings(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* private mode: this visit only */ }
    gateRef.current?.configure(next.mode, next.threshold);
    const room = roomRef.current;
    if (!room) return;
    if (next.inputId !== prev.inputId) void room.switchActiveDevice("audioinput", next.inputId || "default").catch(() => {});
    if (next.outputId !== prev.outputId) void room.switchActiveDevice("audiooutput", next.outputId || "default").catch(() => {});
  }, []);

  // Push to talk: hold the key to send sound. Browsers only tell a site about keys while its tab is
  // the one in front, so letting go of the window also lets go of the key.
  const ptt = status === "connected" && settings.mode === "ptt";
  useEffect(() => {
    if (!ptt) return;
    const key = settings.pttKey;
    const set = (down: boolean) => { gateRef.current?.setKeyDown(down); setPttHeld(down); };
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== key) return;
      if (!isTyping(e.target)) e.preventDefault(); // e.g. Space shouldn't scroll the page
      if (!e.repeat) set(true);
    };
    const onUp = (e: KeyboardEvent) => { if (e.code === key) set(false); };
    const onBlur = () => set(false);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      set(false);
    };
  }, [ptt, settings.pttKey]);

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
    join, leave, toggleMute, toggleDeafen, settings, updateSettings, pttHeld,
  }), [status, roomName, label, href, participants, selfMuted, deafened, canSpeak, error, join, leave, toggleMute, toggleDeafen, settings, updateSettings, pttHeld]);

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export const useVoice = () => useContext(VoiceContext);
