"use client";

import Link from "next/link";
import { useVoice } from "@/components/providers/VoiceProvider";
import { keyLabel } from "@/lib/voice/settings";
import { Microphone, MicrophoneSlash, PhoneDisconnect, SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";

/** Shown above your name while you're in (or joining) a voice room: where, and Mute/Deafen/Leave. */
export function VoiceBar() {
  const { status, label, href, selfMuted, deafened, canSpeak, error, toggleMute, toggleDeafen, leave, settings, pttHeld } = useVoice();
  const ptt = status === "connected" && settings.mode === "ptt" && canSpeak && !selfMuted;
  if (status === "idle" && !error) return null;

  const btn = "flex items-center justify-center w-11 h-11 md:w-8 md:h-8 rounded-control hover:bg-surface-2";
  return (
    <div className="border-t border-line px-2 py-2">
      {status !== "idle" && (
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1 px-1">
            <div className={`text-meta font-semibold ${status === "connected" ? "text-online" : "text-amber"}`} role="status">
              {status === "connected" ? "Voice connected" : "Connecting…"}
            </div>
            {href ? (
              <Link href={href} className="block truncate text-micro text-muted hover:text-ink hover:underline">{label}</Link>
            ) : (
              <span className="block truncate text-micro text-muted">{label}</span>
            )}
          </div>
          <button type="button" onClick={toggleMute} disabled={!canSpeak || status !== "connected"} aria-pressed={selfMuted}
            title={!canSpeak ? "You can't speak here right now" : selfMuted ? "Unmute" : "Mute"} aria-label={selfMuted ? "Unmute" : "Mute"}
            className={`${btn} ${selfMuted ? "text-danger" : "text-muted hover:text-ink"} disabled:opacity-50`}>
            {selfMuted ? <MicrophoneSlash size={18} weight="bold" /> : <Microphone size={18} weight="bold" />}
          </button>
          <button type="button" onClick={toggleDeafen} disabled={status !== "connected"} aria-pressed={deafened}
            title={deafened ? "Undeafen" : "Deafen"} aria-label={deafened ? "Undeafen" : "Deafen"}
            className={`${btn} ${deafened ? "text-danger" : "text-muted hover:text-ink"} disabled:opacity-50`}>
            {deafened ? <SpeakerSlash size={18} weight="bold" /> : <SpeakerHigh size={18} weight="bold" />}
          </button>
          <button type="button" onClick={leave} title="Leave voice" aria-label="Leave voice" className={`${btn} text-muted hover:text-danger`}>
            <PhoneDisconnect size={18} weight="bold" />
          </button>
        </div>
      )}
      {ptt && (
        <p className={`mt-1 px-1 text-micro ${pttHeld ? "text-online" : "text-muted"}`}>
          {pttHeld ? "Talking…" : `Hold ${keyLabel(settings.pttKey)} to talk`}
        </p>
      )}
      {error && <p role="alert" className="mt-1 px-1 text-micro text-danger">{error}</p>}
    </div>
  );
}
