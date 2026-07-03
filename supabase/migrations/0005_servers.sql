-- ===== TABLES =====
create table public.servers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  icon_url text,
  owner_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.server_members (
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (server_id, user_id)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  name text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

-- ===== CHANNELS: add server_id + category_id; drop global-unique name =====
alter table public.channels add column if not exists server_id uuid references public.servers(id) on delete cascade;
alter table public.channels add column if not exists category_id uuid references public.categories(id) on delete set null;
alter table public.channels drop constraint if exists channels_name_key;
alter table public.channels drop constraint if exists channels_name_unique;

-- ===== MIGRATE the existing hardcoded server =====
do $$
declare srv uuid; cat uuid;
begin
  if exists (select 1 from public.channels where server_id is null) then
    insert into public.servers (name) values ('Our Server') returning id into srv;
    insert into public.categories (server_id, name, position) values (srv, 'Text Channels', 0) returning id into cat;
    update public.channels set server_id = srv, category_id = cat where server_id is null;
    insert into public.server_members (server_id, user_id)
      select srv, id from public.profiles on conflict do nothing;
  end if;
end $$;

alter table public.channels alter column server_id set not null;

-- ===== HELPERS =====
create or replace function public.is_server_member(srv uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from public.server_members where server_id = srv and user_id = auth.uid());
$$;

create or replace function public.is_channel_member(chan uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.channels c
    join public.server_members sm on sm.server_id = c.server_id
    where c.id = chan and sm.user_id = auth.uid()
  );
$$;

-- ===== RLS: new tables =====
alter table public.servers enable row level security;
alter table public.server_members enable row level security;
alter table public.categories enable row level security;

create policy "servers readable by authenticated" on public.servers for select to authenticated using (true);
create policy "create own server" on public.servers for insert to authenticated with check (owner_id = auth.uid());
create policy "members update server" on public.servers for update to authenticated using (public.is_server_member(id));

create policy "read server membership" on public.server_members for select to authenticated using (public.is_server_member(server_id));
create policy "self join server" on public.server_members for insert to authenticated with check (user_id = auth.uid());
create policy "self leave server" on public.server_members for delete to authenticated using (user_id = auth.uid());

create policy "members read categories" on public.categories for select to authenticated using (public.is_server_member(server_id));
create policy "members insert categories" on public.categories for insert to authenticated with check (public.is_server_member(server_id));
create policy "members update categories" on public.categories for update to authenticated using (public.is_server_member(server_id));
create policy "members delete categories" on public.categories for delete to authenticated using (public.is_server_member(server_id));

-- ===== RLS: channels become membership-based =====
drop policy if exists "channels readable by authenticated" on public.channels;
create policy "members read channels" on public.channels for select to authenticated using (public.is_server_member(server_id));
create policy "members insert channels" on public.channels for insert to authenticated with check (public.is_server_member(server_id));
create policy "members update channels" on public.channels for update to authenticated using (public.is_server_member(server_id));
create policy "members delete channels" on public.channels for delete to authenticated using (public.is_server_member(server_id));

-- ===== RLS: channel messages require server membership =====
drop policy if exists "read channel messages" on public.messages;
create policy "read channel messages" on public.messages for select to authenticated
  using (channel_id is not null and public.is_channel_member(channel_id));

drop policy if exists "send messages" on public.messages;
create policy "send messages" on public.messages for insert to authenticated
  with check (
    author_id = auth.uid() and (
      (channel_id is not null and public.is_channel_member(channel_id))
      or (conversation_id is not null and public.is_conversation_member(conversation_id))
    )
  );

create or replace function public.can_read_message(msg uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.messages m
    where m.id = msg and (
      (m.channel_id is not null and public.is_channel_member(m.channel_id))
      or (m.conversation_id is not null and public.is_conversation_member(m.conversation_id))
    )
  );
$$;

-- ===== create_server (atomic: server + membership + category + #general) =====
create or replace function public.create_server(server_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare srv uuid; cat uuid;
begin
  insert into public.servers (name, owner_id) values (server_name, auth.uid()) returning id into srv;
  insert into public.server_members (server_id, user_id) values (srv, auth.uid());
  insert into public.categories (server_id, name, position) values (srv, 'Text Channels', 0) returning id into cat;
  insert into public.channels (name, position, server_id, category_id) values ('general', 0, srv, cat);
  return srv;
end $$;
grant execute on function public.create_server(text) to authenticated;

-- ===== REALTIME =====
alter publication supabase_realtime add table public.servers;
alter publication supabase_realtime add table public.server_members;
alter publication supabase_realtime add table public.categories;
alter publication supabase_realtime add table public.channels;
