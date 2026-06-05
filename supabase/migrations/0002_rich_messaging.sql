-- ===== channels.name unique (the live DB predates the canonical 0001 unique) =====
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.channels'::regclass and contype = 'u'
  ) then
    alter table public.channels add constraint channels_name_unique unique (name);
  end if;
end $$;

-- ===== messages: edit + image columns =====
alter table public.messages add column if not exists updated_at timestamptz;
alter table public.messages add column if not exists image_url text;

-- relax the content rule: allow empty content when an image is present
alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages add constraint messages_content_len
  check (char_length(content) <= 2000);
alter table public.messages add constraint messages_nonempty
  check (char_length(content) > 0 or image_url is not null);

-- ===== reactions =====
create table public.reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
create index on public.reactions (message_id);

-- ===== helper: can the current user read a given message? =====
create or replace function public.can_read_message(msg uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.messages m
    where m.id = msg and (
      m.channel_id is not null
      or (m.conversation_id is not null and public.is_conversation_member(m.conversation_id))
    )
  );
$$;

-- ===== RLS: edit/delete own messages =====
create policy "edit own messages"
  on public.messages for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy "delete own messages"
  on public.messages for delete to authenticated
  using (author_id = auth.uid());

-- ===== RLS: reactions =====
alter table public.reactions enable row level security;
create policy "read reactions on readable messages"
  on public.reactions for select to authenticated
  using (public.can_read_message(message_id));
create policy "add own reactions"
  on public.reactions for insert to authenticated
  with check (user_id = auth.uid() and public.can_read_message(message_id));
create policy "remove own reactions"
  on public.reactions for delete to authenticated
  using (user_id = auth.uid());

-- ===== realtime for reactions =====
alter publication supabase_realtime add table public.reactions;
