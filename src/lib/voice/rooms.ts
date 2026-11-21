// LiveKit room names: one room per voice channel and one per DM / group chat call.

export type RoomRef = { type: "channel" | "conversation"; id: string };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ROOM = new RegExp(`^(ch|dm)_(${UUID})$`);

export function roomForChannel(channelId: string): string {
  return `ch_${channelId}`;
}

export function roomForConversation(conversationId: string): string {
  return `dm_${conversationId}`;
}

/** The channel or conversation a room name refers to; null for anything malformed. */
export function parseRoom(name: string): RoomRef | null {
  const m = ROOM.exec(name);
  if (!m) return null;
  return { type: m[1] === "ch" ? "channel" : "conversation", id: m[2] };
}
