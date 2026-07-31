export type Profile = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  status: string | null;
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
  pending?: boolean;
};

export type Reaction = {
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};
