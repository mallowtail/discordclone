import type { Channel, Profile } from "@/types/db";

/**
 * In-memory memory of things already loaded this session, so switching around is instant:
 * channel rows (the channel page renders without waiting for a lookup), each server's channel to
 * open (last visited, else the first), author profiles, and recent messages per chat (shown at once,
 * then refreshed — see useMessages). Everything belongs to one signed-in account: setOwner() with a
 * different user wipes it, so a shared computer never shows the previous person's chats.
 */
const MAX_MESSAGE_CHATS = 30;

let owner: string | null = null;
const channels = new Map<string, Channel>();
const lastChannel = new Map<string, string>(); // server id → channel id
const profiles = new Map<string, Profile>();
const messages = new Map<string, unknown>(); // insertion order = least recently used first

function clear() {
  channels.clear();
  lastChannel.clear();
  profiles.clear();
  messages.clear();
}

export const navCache = {
  setOwner(userId: string | null) {
    if (userId !== owner) {
      clear();
      owner = userId;
    }
  },

  /** Store channel rows. With `fullListFor`, `list` is that server's complete list (drops deleted ones). */
  rememberChannels(list: Channel[], fullListFor?: string) {
    if (fullListFor) {
      for (const [id, c] of channels) if (c.server_id === fullListFor) channels.delete(id);
    }
    for (const c of list) channels.set(c.id, c);
  },
  getChannel(id: string): Channel | undefined {
    return channels.get(id);
  },
  visitChannel(c: Channel) {
    channels.set(c.id, c);
    if (c.server_id) lastChannel.set(c.server_id, c.id);
  },
  /** The channel to open for a server: last visited if it still exists, else the first by position. */
  channelToOpen(serverId: string): string | null {
    const last = lastChannel.get(serverId);
    if (last && channels.get(last)?.server_id === serverId) return last;
    let first: Channel | null = null;
    for (const c of channels.values()) {
      if (c.server_id === serverId && (!first || c.position < first.position)) first = c;
    }
    return first?.id ?? null;
  },

  getProfile(id: string): Profile | undefined {
    return profiles.get(id);
  },
  rememberProfiles(list: Profile[]) {
    for (const p of list) profiles.set(p.id, p);
  },

  getMessages<T>(key: string): T | undefined {
    const v = messages.get(key);
    if (v !== undefined) {
      messages.delete(key);
      messages.set(key, v); // mark as recently used
    }
    return v as T | undefined;
  },
  setMessages<T>(key: string, state: T) {
    messages.delete(key);
    messages.set(key, state);
    while (messages.size > MAX_MESSAGE_CHATS) messages.delete(messages.keys().next().value!);
  },
};
