-- ============ PROFILES ============
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- ============ CHANNELS ============
create table public.channels (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  position int not null default 0,
  created_at timestamptz not null default now()
);

-- ============ CONVERSATIONS (DMs) ============
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  is_group boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (conversation_id, user_id)
);

-- ============ MESSAGES ============
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  channel_id uuid references public.channels(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now(),
  -- a message lives in exactly one place: a channel OR a conversation
  constraint one_target check (
    (channel_id is not null and conversation_id is null) or
    (channel_id is null and conversation_id is not null)
  )
);
create index on public.messages (channel_id, created_at);
create index on public.messages (conversation_id, created_at);

-- ============ HELPER: is the current user a member of a conversation? ============
create or replace function public.is_conversation_member(conv uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = conv and user_id = auth.uid()
  );
$$;

-- ============ ENABLE RLS ============
alter table public.profiles enable row level security;
alter table public.channels enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

-- profiles: anyone logged in can read; you edit only your own
create policy "profiles readable by authenticated"
  on public.profiles for select to authenticated using (true);
create policy "insert own profile"
  on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "update own profile"
  on public.profiles for update to authenticated using (id = auth.uid());

-- channels: anyone logged in can read; no client writes (seeded only)
create policy "channels readable by authenticated"
  on public.channels for select to authenticated using (true);

-- conversations: only members can see
create policy "members read conversations"
  on public.conversations for select to authenticated
  using (public.is_conversation_member(id));
create policy "authenticated create conversations"
  on public.conversations for insert to authenticated with check (true);

-- conversation_members: members can read membership; you can add rows for yourself
create policy "read membership of own conversations"
  on public.conversation_members for select to authenticated
  using (public.is_conversation_member(conversation_id));
create policy "add members to conversations"
  on public.conversation_members for insert to authenticated with check (true);

-- messages: read channel msgs if logged in; read DM msgs only if member
create policy "read channel messages"
  on public.messages for select to authenticated
  using (channel_id is not null);
create policy "read dm messages"
  on public.messages for select to authenticated
  using (conversation_id is not null and public.is_conversation_member(conversation_id));
-- insert: must be the author, and (channel always allowed) or (member of the DM)
create policy "send messages"
  on public.messages for insert to authenticated
  with check (
    author_id = auth.uid() and (
      channel_id is not null
      or (conversation_id is not null and public.is_conversation_member(conversation_id))
    )
  );

-- ============ REALTIME ============
alter publication supabase_realtime add table public.messages;

-- ============ SEED: one shared server's channels ============
insert into public.channels (name, position) values
  ('general', 0), ('homework', 1), ('memes', 2);
