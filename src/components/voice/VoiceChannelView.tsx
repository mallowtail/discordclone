"use client";

import { useVoice } from "@/components/providers/VoiceProvider";
import { useVoiceRooms } from "@/hooks/useVoiceRooms";
import { useDrawer } from "@/components/providers/DrawerProvider";
import { navCache } from "@/lib/cache/navCache";
import { roomForChannel } from "@/lib/voice/rooms";
import { Avatar } from "@/components/user/profile/Avatar";
import type { Channel } from "@/types/db";
import { List, MicrophoneSlash, SpeakerHigh } from "@phosphor-icons/react";

/** The page for a voice channel (if you open its address): who's in it, and Join / Leave. */
export function VoiceChannelView({ channel }: { channel: Channel }) {
  const voice = useVoice();
  const { open: drawerOpen, toggleDrawer } = useDrawer();
  const rooms = useVoiceRooms(channel.server_id, true);
  const room = roomForChannel(channel.id);
  const here = voice.room === room && voice.status !== "idle";
  const people = here
    ? voice.participants
    : (rooms[channel.id] ?? []).map((o) => ({ ...o, speaking: false, isLocal: false }));

  return (
    <>
      <header className="p-3 border-b border-line flex items-center gap-2 min-w-0 font-semibold text-ink">
        <button onClick={toggleDrawer} aria-label="Open navigation" aria-expanded={drawerOpen}
          className="md:hidden -ml-1 flex items-center justify-center w-11 h-11 flex-none text-muted hover:text-ink">
          <List size={20} weight="bold" aria-hidden="true" />
        </button>
        <SpeakerHigh size={18} weight="bold" className="text-muted flex-none" aria-hidden="true" />
        <span className="truncate">{channel.name}</span>
      </header>
      <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6">
        {people.length === 0 ? (
          <p className="text-body text-muted">No one&apos;s here yet.</p>
        ) : (
          <ul className="flex flex-wrap justify-center gap-6" aria-label={`In ${channel.name}`}>
            {people.map((p) => (
              <li key={p.id} className="flex flex-col items-center gap-2 w-24">
                <span className={`rounded-pill ${p.speaking ? "ring-4 ring-online ring-offset-2 ring-offset-app" : ""}`}>
                  <Avatar url={navCache.getProfile(p.id)?.avatar_url ?? null} name={p.name} seed={p.id} size="xl" />
                </span>
                <span className="flex items-center gap-1 max-w-full text-body text-ink">
                  <span className="truncate">{p.name}</span>
                  {p.muted && <MicrophoneSlash size={14} weight="bold" className="flex-none text-danger" aria-label="Muted" />}
                </span>
              </li>
            ))}
          </ul>
        )}
        {here ? (
          <button type="button" onClick={() => void voice.leave()}
            className="rounded-control bg-danger/90 hover:bg-danger px-5 py-2 text-body font-medium text-white">
            Leave voice
          </button>
        ) : (
          <button type="button" onClick={() => void voice.join(room, channel.name, `/channels/${channel.id}`)}
            disabled={voice.status === "connecting"}
            className="rounded-control bg-online/90 hover:bg-online px-5 py-2 text-body font-medium text-app disabled:opacity-50">
            {voice.status === "connecting" && voice.room === room ? "Connecting…" : "Join voice"}
          </button>
        )}
      </div>
    </>
  );
}
