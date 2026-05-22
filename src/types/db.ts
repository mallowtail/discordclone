export type Profile = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
};

export type Channel = {
  id: string;
  name: string;
  position: number;
  created_at: string;
};

export type Message = {
  id: string;
  author_id: string;
  channel_id: string | null;
  conversation_id: string | null;
  content: string;
  created_at: string;
};
