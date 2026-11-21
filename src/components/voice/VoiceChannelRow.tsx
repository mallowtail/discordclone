"use client";

import type { VoiceOccupant } from "@/app/api/voice/rooms/route";
import { useVoice } from "@/components/providers/VoiceProvider";
import { navCache } from "@/lib/cache/navCache";
import { roomForChannel } from "@/lib/voice/rooms";
import { Avatar } from "@/components/user/profile/Avatar";
import type { Channel } from "@/types/db";
import { MicrophoneSlash, SpeakerHigh } from "@phosphor-icons/react";

/**
 * A voice channel in the server sidebar: click to join (no ringing), with who's in it underneath.
 * For the room you're in, the list is live from your own connection (green ring = talking);
 * other rooms come from the 8-second poll.
 */
export function VoiceChannelRow({ channel, occupants, hasMargin }: { channel: Channel; occupants: VoiceOccupant[]; hasMargin?: boolean }) {
  const voice = useVoice();
  const room = roomForChannel(channel.id);
  const here = voice.room === room && voice.status !== "idle";
  const people = here
    ? voice.participants.map((p) => ({ id: p.id, name: p.name, muted: p.muted, speaking: p.speaking }))
    : occupants.map((o) => ({ ...o, speaking: false }));

  return (
    <div className={hasMargin ? "ml-2" : undefined}>
      <button type="button" onClick={() => void voice.join(room, channel.name, `/channels/${channel.id}`)}
        aria-label={`Join voice channel ${channel.name}${people.length ? `, ${people.length} inside` : ""}`}
        className={`w-full flex items-center gap-2 px-2 py-1 min-h-11 md:min-h-0 rounded-row text-body text-left ${
          here ? "bg-surface text-ink font-medium" : "text-muted hover:bg-surface/60 hover:text-ink"
        }`}>
        <SpeakerHigh size={16} weight="bold" aria-hidden="true" className={here ? "text-online" : undefined} />
        <span className="truncate">{channel.name}</span>
      </button>
      {people.length > 0 && (
        <ul className="ml-6 mb-1 space-y-0.5" aria-label={`In ${channel.name}`}>
          {people.map((p) => (
            <li key={p.id} className="flex items-center gap-2 px-1 py-0.5 text-meta text-muted">
              <span className={`flex-none rounded-pill ${p.speaking ? "ring-2 ring-online ring-offset-1 ring-offset-sidebar" : ""}`}>
                <Avatar url={navCache.getProfile(p.id)?.avatar_url ?? null} name={p.name} seed={p.id} size="sm" />
              </span>
              <span className="truncate">{p.name}</span>
              {p.muted && <MicrophoneSlash size={12} weight="bold" className="flex-none text-danger/80" aria-label="Muted" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
