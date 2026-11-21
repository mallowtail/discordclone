-- Server stickers. Admins (new permission `manage_stickers`) upload up to 30 pictures per server;
-- anyone in the server can send them anywhere (its channels, other servers, DMs, groups). A sticker
-- message keeps its own copy of the sticker (id, name, URL, size) in `messages.sticker`, rebuilt here
-- from the sticker row, so everyone who can see the message sees it. The sender must be in the
-- sticker's server. Deleting a sticker turns every copy (and forwarded copy) into
-- {id, name, removed: true} so the app shows "Sticker removed".

-- ---------- 1. permission ----------
alter table public.roles drop constraint if exists roles_valid_permissions;
alter table public.roles add constraint roles_valid_permissions check (
  permissions <@ array['manage_channels','manage_server','manage_roles',
    'kick_members','ban_members','timeout_members','manage_messages','manage_stickers']::text[]
);

-- Same as 0018, plus manage_stickers for the owner.
create or replace function public.my_permissions(srv uuid)
returns text[] language sql security definer set search_path = public stable as $$
  select case
    when exists (select 1 from public.servers s where s.id = srv and s.owner_id = auth.uid())
      then array['manage_channels','manage_server','manage_roles',
                 'kick_members','ban_members','timeout_members','manage_messages','manage_stickers']::text[]
    else coalesce((
      select array_agg(distinct p)
      from public.member_roles mr
      join public.roles r on r.id = mr.role_id
      cross join lateral unnest(r.permissions) as p
      where mr.server_id = srv and mr.user_id = auth.uid()
    ), array[]::text[])
  end;
$$;

-- Existing admins get the new permission on day one.
update public.roles set permissions = permissions || array['manage_stickers']
  where 'manage_server' = any(permissions) and not 'manage_stickers' = any(permissions);

-- ---------- 2. stickers table ----------
create table public.stickers (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  name text not null,
  path text not null,
  width int not null,
  height int not null,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint stickers_name check (char_length(name) between 2 and 30 and name !~ '[[:cntrl:]]'),
  constraint stickers_size check (width between 1 and 4000 and height between 1 and 4000),
  constraint stickers_path check (path ~ ('^' || server_id::text || '/[0-9a-f-]{36}\.(png|gif|webp)$'))
);
create unique index stickers_server_name on public.stickers (server_id, lower(name));

-- ---------- 3. clean the name; only the name may change ----------
-- Invoker rights: is_direct_client() reads current_user (see 0032). Updates made by the database
-- itself (created_by set to null when a profile is deleted) are let through.
create or replace function public.clean_sticker()
returns trigger language plpgsql set search_path = public as $$
begin
  new.name := btrim(regexp_replace(new.name, '\s+', ' ', 'g'));
  if tg_op = 'INSERT' then
    if public.is_direct_client() then
      new.created_at := now();
    end if;
  elsif public.is_direct_client() and (
       new.id is distinct from old.id
    or new.server_id is distinct from old.server_id
    or new.path is distinct from old.path
    or new.width is distinct from old.width
    or new.height is distinct from old.height
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at) then
    raise exception 'only the sticker name can be changed';
  end if;
  return new;
end $$;
create trigger stickers_clean before insert or update on public.stickers
  for each row execute function public.clean_sticker();

-- ---------- 4. at most 30 per server ----------
-- The per-server lock makes two simultaneous uploads queue up, so they can't both see 29.
-- Security definer so the count sees every row regardless of the caller's read access.
create or replace function public.limit_stickers()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('stickers:' || new.server_id::text, 0));
  if (select count(*) from public.stickers s where s.server_id = new.server_id) >= 30 then
    raise exception 'sticker limit reached';
  end if;
  return new;
end $$;
revoke execute on function public.limit_stickers() from public, anon, authenticated;
create trigger stickers_limit before insert on public.stickers
  for each row execute function public.limit_stickers();

-- ---------- 5. who can see / change stickers ----------
alter table public.stickers enable row level security;
create policy "members read stickers" on public.stickers for select to authenticated
  using (public.is_server_member(server_id));
create policy "managers add stickers" on public.stickers for insert to authenticated
  with check (created_by = auth.uid() and public.has_server_permission(server_id, 'manage_stickers'));
create policy "managers rename stickers" on public.stickers for update to authenticated
  using (public.has_server_permission(server_id, 'manage_stickers'))
  with check (public.has_server_permission(server_id, 'manage_stickers'));
create policy "managers delete stickers" on public.stickers for delete to authenticated
  using (public.has_server_permission(server_id, 'manage_stickers'));

-- ---------- 6. storage bucket ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stickers', 'stickers', true, 524288,
        array['image/png','image/gif','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- The server a sticker file belongs to: the first folder of `<server_id>/<sticker_id>.<ext>`.
-- A path without a folder, or whose folder isn't a uuid, gives null (so the policy refuses it
-- instead of erroring).
create or replace function public.sticker_folder_server(object_name text)
returns uuid language plpgsql immutable as $$
declare
  folder text := split_part(coalesce(object_name, ''), '/', 1);
begin
  if position('/' in coalesce(object_name, '')) = 0
     or folder !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return null;
  end if;
  return folder::uuid;
end $$;

drop policy if exists "public read stickers" on storage.objects;
create policy "public read stickers"
  on storage.objects for select to public
  using (bucket_id = 'stickers');

drop policy if exists "managers upload stickers" on storage.objects;
create policy "managers upload stickers"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'stickers'
    and public.has_server_permission(public.sticker_folder_server(name), 'manage_stickers'));

drop policy if exists "managers delete stickers" on storage.objects;
create policy "managers delete stickers"
  on storage.objects for delete to authenticated
  using (bucket_id = 'stickers'
    and public.has_server_permission(public.sticker_folder_server(name), 'manage_stickers'));

-- ---------- 7. sticker messages ----------
alter table public.messages add column sticker jsonb;

alter table public.messages add constraint messages_sticker check (
  sticker is null or (
    jsonb_typeof(sticker) = 'object'
    and coalesce(sticker->>'id', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and jsonb_typeof(sticker->'name') = 'string'
    and char_length(sticker->>'name') <= 30
    and (
      coalesce(sticker->'removed' = 'true'::jsonb, false)
      or (
        coalesce(sticker->>'url', '') ~ '^https://dpsikhsxdwigeuyonfch\.supabase\.co/storage/v1/object/public/stickers/[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|gif|webp)$'
        and case when jsonb_typeof(sticker->'width') = 'number'
              then (sticker->>'width')::numeric between 1 and 4000 else false end
        and case when jsonb_typeof(sticker->'height') = 'number'
              then (sticker->>'height')::numeric between 1 and 4000 else false end
      )
    )
  )
);

-- A message with just a sticker is fine (0036 plus sticker).
alter table public.messages drop constraint messages_nonempty;
alter table public.messages add constraint messages_nonempty check (
  char_length(content) > 0 or image_url is not null or file_url is not null or forward_snapshot is not null or gif is not null
  or sticker is not null
);

-- Deleting a sticker finds its copies through these.
create index messages_sticker_id on public.messages ((sticker->>'id')) where sticker is not null;
create index messages_forward_sticker_id on public.messages ((forward_snapshot->'sticker'->>'id'))
  where forward_snapshot is not null;

-- ---------- 8. sticker lookup for sending ----------
-- The sticker, only if the caller is in its server (otherwise null).
create or replace function public.sticker_for_send(sid uuid)
returns public.stickers language sql stable security definer set search_path = public as $$
  select s.* from public.stickers s where s.id = sid and public.is_server_member(s.server_id);
$$;
revoke execute on function public.sticker_for_send(uuid) from public, anon;
grant execute on function public.sticker_for_send(uuid) to authenticated;

-- ---------- 9. insert guard (0037 plus stickers) ----------
-- Still an invoker function: is_direct_client() reads current_user (see 0032).
create or replace function public.guard_message_insert()
returns trigger language plpgsql set search_path = public as $$
declare
  src public.messages;
  src_id uuid;
  st public.stickers;
  st_id uuid;
begin
  if not public.is_direct_client() then
    return new;
  end if;

  -- 7. spam limit
  if public.recent_message_count() >= 5 then
    raise exception 'slow down: too many messages' using hint = 'rate_limited';
  end if;

  new.content := public.strip_message_controls(new.content);
  -- Server-controlled fields: a new message is never pre-pinned, edited, or backdated.
  new.created_at := now();
  new.updated_at := null;
  new.pinned := false;
  new.pinned_at := null;

  -- 2. forwards: the client names the message; the snapshot is rebuilt from it here.
  if new.forward_snapshot is not null then
    begin
      src_id := (new.forward_snapshot->>'message_id')::uuid;
    exception when invalid_text_representation then
      src_id := null;
    end;
    if src_id is null or not public.can_read_message(src_id) then
      raise exception 'cannot forward that message';
    end if;
    select * into src from public.messages m where m.id = src_id;
    new.forward_snapshot := jsonb_build_object(
      'message_id', src.id,
      'author_id', src.author_id,
      'content', coalesce(src.content, ''),
      'image_url', src.image_url,
      'file_url', src.file_url,
      'file_name', src.file_name,
      'gif', src.gif,
      'sticker', src.sticker,
      'source', case
        when src.channel_id is not null then coalesce('#' || (select c.name from public.channels c where c.id = src.channel_id), 'a channel')
        else 'a direct message'
      end
    );
  end if;

  -- Stickers: the client names the sticker; you must be in its server; the snapshot is rebuilt
  -- from the sticker row here; a sticker message has nothing else in it.
  if new.sticker is not null then
    begin
      st_id := (new.sticker->>'id')::uuid;
    exception when invalid_text_representation then
      st_id := null;
    end;
    if st_id is null then
      raise exception 'cannot use that sticker';
    end if;
    st := public.sticker_for_send(st_id);
    if st.id is null then
      raise exception 'cannot use that sticker';
    end if;
    if new.content <> '' or new.image_url is not null or new.file_url is not null
       or new.gif is not null or new.forward_snapshot is not null or new.poll then
      raise exception 'a sticker is sent on its own';
    end if;
    new.sticker := jsonb_build_object(
      'id', st.id,
      'name', st.name,
      'url', 'https://dpsikhsxdwigeuyonfch.supabase.co/storage/v1/object/public/stickers/' || st.path,
      'width', st.width,
      'height', st.height
    );
  end if;
  return new;
end $$;

-- ---------- 10. update guard (0036 plus stickers) ----------
create or replace function public.guard_message_update()
returns trigger language plpgsql as $$
begin
  if not public.is_direct_client() then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.author_id is distinct from old.author_id
     or new.channel_id is distinct from old.channel_id
     or new.conversation_id is distinct from old.conversation_id
     or new.created_at is distinct from old.created_at
     or new.image_url is distinct from old.image_url
     or new.file_url is distinct from old.file_url
     or new.file_name is distinct from old.file_name
     or new.reply_to_id is distinct from old.reply_to_id
     or new.mention_author is distinct from old.mention_author
     or new.pinned is distinct from old.pinned
     or new.pinned_at is distinct from old.pinned_at
     or new.forward_snapshot is distinct from old.forward_snapshot
     or new.poll is distinct from old.poll
     or new.gif is distinct from old.gif
     or new.sticker is distinct from old.sticker then
    raise exception 'only the message text can be edited';
  end if;
  if old.poll and new.content is distinct from old.content then
    raise exception 'polls can''t be edited';
  end if;
  -- A sticker is sent on its own, so it can't gain text by editing either.
  if old.sticker is not null and new.content is distinct from old.content then
    raise exception 'a sticker is sent on its own';
  end if;
  new.content := public.strip_message_controls(new.content);
  new.updated_at := case when new.content is distinct from old.content then now() else old.updated_at end;
  return new;
end $$;

-- ---------- 11. deleting a sticker removes it from past messages ----------
-- Security definer: gets past the author-only update policy and (since current_user is then the
-- owner) the direct-client rules in guard_message_update.
create or replace function public.remove_deleted_sticker()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  gone jsonb := jsonb_build_object('id', old.id, 'name', old.name, 'removed', true);
begin
  update public.messages set sticker = gone
    where sticker is not null and sticker->>'id' = old.id::text;
  update public.messages set forward_snapshot = jsonb_set(forward_snapshot, '{sticker}', gone)
    where forward_snapshot is not null and forward_snapshot->'sticker'->>'id' = old.id::text;
  return old;
end $$;
revoke execute on function public.remove_deleted_sticker() from public, anon, authenticated;
create trigger stickers_remove_from_messages after delete on public.stickers
  for each row execute function public.remove_deleted_sticker();

-- ---------- 12. audit log ----------
alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check check (
  action in ('kick', 'ban', 'unban', 'timeout', 'timeout_removed', 'sticker_create', 'sticker_delete')
);

-- The sticker's name goes in `reason` (target_id refers to people). When the whole server is being
-- deleted its stickers go with it; nothing is logged then (the log is going too).
create or replace function public.audit_sticker()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (server_id, action, actor_id, reason)
      values (new.server_id, 'sticker_create', auth.uid(), new.name);
    return new;
  end if;
  if exists (select 1 from public.servers where id = old.server_id) then
    insert into public.audit_log (server_id, action, actor_id, reason)
      values (old.server_id, 'sticker_delete', auth.uid(), old.name);
  end if;
  return old;
end $$;
revoke execute on function public.audit_sticker() from public, anon, authenticated;
create trigger stickers_audit after insert or delete on public.stickers
  for each row execute function public.audit_sticker();

-- ---------- 13. realtime ----------
alter publication supabase_realtime add table public.stickers;
