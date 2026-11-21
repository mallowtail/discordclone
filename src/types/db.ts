import type { MessageSticker } from "@/lib/messages/stickers";

export type Profile = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  status: string | null;
  recent_emojis: string[];
  /** Hostnames whose links open without the "Leaving Mallowchat" warning. */
  trusted_domains: string[];
  /** Who can DM you / add you to groups (enforced in the database, migration 0040). */
  dm_policy: "reachable" | "friends" | "none";
  /** Who can send you friend requests. */
  fr_everyone: boolean;
  fr_friends_of_friends: boolean;
  fr_server_members: boolean;
  created_at: string;
  /** Set when the account was deleted (migration 0046): the row is then a "Deleted User" tombstone. */
  deleted_at: string | null;
  /** Set while the account is site-banned (migration 0052; only the site admin sets/clears it). Everyone
   *  else sees the person as "Deleted User" — see shownProfile in lib/users/account. */
  banned_at: string | null;
};

export type Server = {
  id: string;
  name: string;
  /** Up to 300 characters (migration 0041). */
  description: string | null;
  icon_url: string | null;
  owner_id: string | null;
  is_public: boolean;
  invite_code: string | null;
  created_at: string;
};

export type Invite = {
  code: string;
  server_id: string;
  created_by: string | null;
  created_at: string;
  expires_at: string | null;
  max_uses: number | null;
  uses: number;
  is_vanity: boolean;
};

export type ServerMember = {
  server_id: string;
  user_id: string;
  joined_at: string;
  role: "admin" | "member";
};

export type Role = {
  id: string;
  server_id: string;
  name: string;
  color: string | null;
  permissions: string[];
  position: number;
  created_at: string;
};

export type MemberRole = {
  server_id: string;
  user_id: string;
  role_id: string;
};

export type Category = {
  id: string;
  server_id: string;
  name: string;
  position: number;
  created_at: string;
};

export type Channel = {
  id: string;
  name: string;
  position: number;
  created_at: string;
  server_id: string;
  category_id: string | null;
  /** "voice" channels are LiveKit rooms (migration 0042); missing means "text". */
  kind?: "text" | "voice";
};

export type ForwardSnapshot = {
  /** The original message. The server rebuilds the rest of the snapshot from it (so forwards can't be
   *  faked); absent on forwards made before that rule. */
  message_id?: string;
  author_id: string;
  content: string;
  image_url: string | null;
  file_url: string | null;
  file_name: string | null;
  /** Filled in by the server when the forwarded message was a GIF. */
  gif?: { url: string; width: number; height: number; title: string } | null;
  sticker?: MessageSticker | null;
  source: string;
};

export type Message = {
  id: string;
  author_id: string;
  channel_id: string | null;
  conversation_id: string | null;
  content: string;
  image_url: string | null;
  file_url: string | null;
  file_name: string | null;
  created_at: string;
  updated_at: string | null;
  reply_to_id: string | null;
  mention_author: boolean;
  pinned: boolean;
  pinned_at: string | null;
  /** "Keep this message" (migration 0054): never removed by the database safety net, and its upload
   *  isn't expired after 30 days. Set only through `set_message_kept`. */
  kept: boolean;
  forward_snapshot: ForwardSnapshot | null;
  /** A poll: `content` is the question; answers and votes live in polls / poll_options / poll_votes. */
  poll?: boolean;
  /** A KLIPY GIF (shown through our relay); see lib/gifs. */
  gif?: { url: string; width: number; height: number; title: string } | null;
  /** A server sticker (content is empty); see lib/stickers. */
  sticker?: MessageSticker | null;
  pending?: boolean;
};

export type Reaction = {
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

export type ChannelRead = {
  user_id: string;
  channel_id: string;
  last_read_at: string;
};

export type Ban = {
  server_id: string;
  user_id: string;
  banned_by: string | null;
  reason: string | null;
  created_at: string;
};

export type SearchResult = {
  id: string;
  channel_id: string;
  channel_name: string;
  author_id: string;
  author_username: string;
  author_display_name: string;
  author_avatar_url: string | null;
  content: string | null;
  image_url: string | null;
  file_url: string | null;
  file_name: string | null;
  pinned: boolean;
  created_at: string;
  total_count: number;
};
