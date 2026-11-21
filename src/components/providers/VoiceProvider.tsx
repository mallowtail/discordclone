"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Room, RoomEvent, ScreenSharePresets, Track,
  type Participant, type RemoteParticipant, type RemoteTrack, type RemoteTrackPublication,
} from "livekit-client";
import { useAuth } from "@/components/providers/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import { parseRoom } from "@/lib/voice/rooms";
import { DEFAULT_SETTINGS, STORAGE_KEY, parseVoiceSettings, type VoiceSettings } from "@/lib/voice/settings";
import { createMicGate, type MicGate } from "@/components/voice/micGate";

export type VoiceParticipant = {
  id: string; name: string; speaking: boolean; muted: boolean; isLocal: boolean;
  /** Sharing their screen right now. */
  sharing: boolean;
  /** Their screen's video has arrived here (you're watching it, or it's your own). */
  screenReady: boolean;
};

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
  /** This browser can share its screen (computers; not phone browsers). */
  canShare: boolean;
  sharing: boolean;
  toggleShare: () => Promise<void>;
  /** Screens you've chosen to watch (participant ids). Streams only download while watched. */
  watching: string[];
  watch: (id: string) => void;
  unwatch: (id: string) => void;
  /** Show someone's screen in a <video>. Returns a cleanup function. */
  attachScreen: (id: string, el: HTMLVideoElement) => () => void;
};

const VoiceContext = createContext<Ctx>({
  status: "idle", room: null, label: null, href: null, participants: [], selfMuted: false, deafened: false,
  canSpeak: true, error: null, join: async () => {}, leave: async () => {}, toggleMute: async () => {}, toggleDeafen: async () => {},
  settings: DEFAULT_SETTINGS, updateSettings: () => {}, pttHeld: false,
  canShare: false, sharing: false, toggleShare: async () => {}, watching: [], watch: () => {}, unwatch: () => {},
  attachScreen: () => () => {},
});

const SCREEN_SOURCES = [Track.Source.ScreenShare, Track.Source.ScreenShareAudio];

/** Microphones always play; screens (video and their sound) only for people watching them. */
function subscribeFor(pub: RemoteTrackPublication, watched: boolean) {
  if (pub.source === Track.Source.Microphone) pub.setSubscribed(true);
  else if (SCREEN_SOURCES.includes(pub.source)) pub.setSubscribed(watched);
}

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
    sharing: p.isScreenShareEnabled,
    screenReady: !!p.getTrackPublication(Track.Source.ScreenShare)?.track,
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
  const [sharing, setSharing] = useState(false);
  const [watching, setWatching] = useState<string[]>([]);
  const watchingRef = useRef<string[]>([]);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser feature check (not known during server render)
    setCanShare(typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function");
  }, []);

  const reset = useCallback(() => {
    for (const el of audioEls.current) el.remove();
    audioEls.current.clear();
    roomRef.current = null;
    gateRef.current = null;
    void gateCtxRef.current?.close().catch(() => {});
    gateCtxRef.current = null;
    setPttHeld(false);
    setSharing(false);
    watchingRef.current = [];
    setWatching([]);
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
        refresh();
        if (track.kind !== Track.Kind.Audio) return;
        const el = track.attach();
        el.muted = deafRef.current;
        el.style.display = "none";
        document.body.appendChild(el);
        audioEls.current.add(el);
      })
      .on(RoomEvent.TrackPublished, (pub: RemoteTrackPublication, p: RemoteParticipant) => {
        subscribeFor(pub, watchingRef.current.includes(p.identity));
        refresh();
      })
      .on(RoomEvent.TrackUnpublished, (pub: RemoteTrackPublication, p: RemoteParticipant) => {
        // Their share ended: stop "watching" a screen that's gone.
        if (pub.source === Track.Source.ScreenShare && watchingRef.current.includes(p.identity)) {
          watchingRef.current = watchingRef.current.filter((x) => x !== p.identity);
          setWatching(watchingRef.current);
        }
        refresh();
      })
      .on(RoomEvent.LocalTrackUnpublished, (pub) => {
        // Includes the browser's own "Stop sharing" button.
        if (pub.source === Track.Source.ScreenShare && roomRef.current === room) setSharing(false);
        refresh();
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        refresh();
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
      await room.connect(url, body.token, { autoSubscribe: false });
      for (const p of room.remoteParticipants.values()) for (const pub of p.trackPublications.values()) subscribeFor(pub, false);
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

  const toggleShare = useCallback(async () => {
    const room = roomRef.current;
    if (!room || !canSpeak) return;
    const next = !room.localParticipant.isScreenShareEnabled;
    try {
      // 720p at 30 fps: smooth enough for games, light on the free plan's data allowance.
      await room.localParticipant.setScreenShareEnabled(next, next ? {
        audio: true, resolution: ScreenSharePresets.h720fps30.resolution, contentHint: "motion", selfBrowserSurface: "exclude",
      } : undefined, next ? { screenShareEncoding: ScreenSharePresets.h720fps30.encoding } : undefined);
      setSharing(next);
      setError(null);
    } catch (e) {
      // Pressing "Cancel" in the browser's picker isn't an error.
      if (!(e instanceof DOMException && e.name === "NotAllowedError")) setError("Couldn't share your screen — try again");
      setSharing(room.localParticipant.isScreenShareEnabled);
    }
    setParticipants(snapshot(room));
  }, [canSpeak]);

  const setWatched = useCallback((id: string, on: boolean) => {
    const list = watchingRef.current.filter((x) => x !== id);
    watchingRef.current = on ? [...list, id] : list;
    setWatching(watchingRef.current);
    const p = roomRef.current?.remoteParticipants.get(id);
    if (p) for (const pub of p.trackPublications.values()) subscribeFor(pub, on);
  }, []);
  const watch = useCallback((id: string) => setWatched(id, true), [setWatched]);
  const unwatch = useCallback((id: string) => setWatched(id, false), [setWatched]);

  const attachScreen = useCallback((id: string, el: HTMLVideoElement) => {
    const room = roomRef.current;
    const p = !room ? undefined : room.localParticipant.identity === id ? room.localParticipant : room.remoteParticipants.get(id);
    const track = p?.getTrackPublication(Track.Source.ScreenShare)?.track;
    if (!track) return () => {};
    track.attach(el);
    el.muted = true; // the screen's sound plays through the hidden audio elements (so deafen applies)
    return () => { track.detach(el); };
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
    canShare, sharing, toggleShare, watching, watch, unwatch, attachScreen,
  }), [status, roomName, label, href, participants, selfMuted, deafened, canSpeak, error, join, leave, toggleMute, toggleDeafen,
    settings, updateSettings, pttHeld, canShare, sharing, toggleShare, watching, watch, unwatch, attachScreen]);

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export const useVoice = () => useContext(VoiceContext);
