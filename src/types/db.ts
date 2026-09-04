export type Profile = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  status: string | null;
  recent_emojis: string[];
  created_at: string;
};

export type Server = {
  id: string;
  name: string;
  icon_url: string | null;
  owner_id: string | null;
  is_public: boolean;
  invite_code: string | null;
  created_at: string;
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
};

export type ForwardSnapshot = {
  author_id: string;
  content: string;
  image_url: string | null;
  file_url: string | null;
  file_name: string | null;
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
  forward_snapshot: ForwardSnapshot | null;
  pending?: boolean;
};

export type Reaction = {
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
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
};
