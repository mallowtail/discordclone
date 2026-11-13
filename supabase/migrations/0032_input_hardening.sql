-- Input hardening. The website already validates what people type, but the database can be called
-- directly (it's how Supabase works), so these rules now live here too:
--
--   1. Editing a message can only change its text (not its channel, image, pin, forward, …).
--   2. Forwards are rebuilt from the real message, which you must be able to see — no fake forwards.
--   3. Profiles: username format, display name / bio / status lengths, invisible and
--      backwards-text characters stripped (they're used to impersonate people).
--   4. Server, channel, category, role and group names: invisible characters stripped, 1–100
--      characters; role colours must be #rrggbb.
--   5. Images, files, avatars and server icons must live in this project's own storage (avatars may
--      also be GitHub/Discord profile pictures, from those sign-ins). An image hosted elsewhere
--      would show every viewer's IP address to whoever runs that site.
--   6. The attachments bucket only accepts images and plain downloads.
--   7. Spam limit: at most 5 messages per 5 seconds per person.
--
-- "Direct client" below means a request from the app's users (role `authenticated`/`anon`).
-- Security-definer functions such as toggle_pin run as the table owner, so they're not limited by
-- the per-column rules meant for direct edits.

-- ---------- helpers ----------

-- Characters that render as nothing or flip text direction. Stripped from names, bios and statuses
-- (blank names, look-alike names). ZWJ (U+200D) is kept: emoji sequences need it.
create or replace function public.strip_invisible(t text)
returns text language sql immutable as $$
  select case when t is null then null else regexp_replace(
    t,
    '[\x01-\x1F\x7F-\x9F­ᅟᅠ᠎​‌‎‏‪-‮⁠-⁤⁦-⁩ㅤ﻿ﾠ]',
    '', 'g') end;
$$;

-- Messages keep newlines and tabs and every script's joiners; only other control characters and the
-- text-direction overrides (which can make text read differently than it was typed) go.
create or replace function public.strip_message_controls(t text)
returns text language sql immutable as $$
  select case when t is null then null else regexp_replace(
    t, '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F‪-‮⁦-⁩]', '', 'g') end;
$$;

-- A public URL of a file in one of this project's storage buckets (paths are random-uuid.ext).
create or replace function public.is_own_storage_url(url text, bucket text)
returns boolean language sql immutable as $$
  select url ~ ('^https://dpsikhsxdwigeuyonfch\.supabase\.co/storage/v1/object/public/' || bucket || '/[A-Za-z0-9_-]+(\.[A-Za-z0-9]+)?$');
$$;

create or replace function public.is_direct_client()
returns boolean language sql stable as $$
  select current_user in ('authenticated', 'anon');
$$;

-- ---------- 3. profiles ----------

create or replace function public.clean_profile()
returns trigger language plpgsql as $$
begin
  new.display_name := btrim(public.strip_invisible(new.display_name));
  new.bio := public.strip_invisible(new.bio);
  new.status := public.strip_invisible(new.status);
  if tg_op = 'UPDATE' and public.is_direct_client() then
    new.id := old.id;
    new.created_at := old.created_at; -- "Member since" can't be faked
  end if;
  return new;
end $$;
drop trigger if exists profiles_clean on public.profiles;
create trigger profiles_clean before insert or update on public.profiles
  for each row execute function public.clean_profile();

alter table public.profiles
  add constraint profiles_username_format check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  add constraint profiles_display_name_len check (char_length(display_name) between 1 and 32),
  add constraint profiles_bio_len check (bio is null or char_length(bio) <= 190),
  add constraint profiles_status_len check (status is null or char_length(status) <= 128),
  add constraint profiles_recent_emojis_len check (cardinality(recent_emojis) <= 12),
  add constraint profiles_avatar_url check (
    avatar_url is null
    or public.is_own_storage_url(avatar_url, 'avatars')
    or avatar_url ~ '^https://(avatars\.githubusercontent\.com|cdn\.discordapp\.com)/'
  );

-- ---------- 4. other names ----------

create or replace function public.clean_name()
returns trigger language plpgsql as $$
begin
  new.name := nullif(btrim(public.strip_invisible(new.name)), '');
  return new;
end $$;

-- conversations.name stays nullable (null = named after the members); the others are required.
drop trigger if exists servers_clean_name on public.servers;
create trigger servers_clean_name before insert or update of name on public.servers
  for each row execute function public.clean_name();
drop trigger if exists channels_clean_name on public.channels;
create trigger channels_clean_name before insert or update of name on public.channels
  for each row execute function public.clean_name();
drop trigger if exists categories_clean_name on public.categories;
create trigger categories_clean_name before insert or update of name on public.categories
  for each row execute function public.clean_name();
drop trigger if exists roles_clean_name on public.roles;
create trigger roles_clean_name before insert or update of name on public.roles
  for each row execute function public.clean_name();
drop trigger if exists conversations_clean_name on public.conversations;
create trigger conversations_clean_name before insert or update of name on public.conversations
  for each row execute function public.clean_name();

alter table public.servers
  add constraint servers_name_len check (char_length(name) between 1 and 100),
  add constraint servers_icon_url check (icon_url is null or public.is_own_storage_url(icon_url, 'server-icons'));
alter table public.channels add constraint channels_name_len check (char_length(name) between 1 and 100);
alter table public.categories add constraint categories_name_len check (char_length(name) between 1 and 100);
alter table public.roles
  add constraint roles_name_len check (char_length(name) between 1 and 100),
  add constraint roles_color_format check (color is null or color ~ '^#[0-9A-Fa-f]{6}$');

-- ---------- 5. message attachments ----------

alter table public.messages
  add constraint messages_image_url check (image_url is null or public.is_own_storage_url(image_url, 'attachments')),
  add constraint messages_file_url check (file_url is null or public.is_own_storage_url(file_url, 'attachments')),
  add constraint messages_file_name check (
    file_name is null or (file_url is not null and char_length(file_name) between 1 and 255)
  );

-- ---------- 1, 2, 7. messages ----------

create index if not exists messages_author_created on public.messages (author_id, created_at);

-- The caller's own messages in the last 5 seconds. Counted with definer rights so messages in places
-- they can no longer read still count. Rows from the current transaction (created_at = now()) aren't
-- counted, so forwarding one message to several places at once is a single burst.
create or replace function public.recent_message_count()
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.messages m
  where m.author_id = auth.uid() and m.created_at > now() - interval '5 seconds' and m.created_at < now();
$$;
revoke execute on function public.recent_message_count() from public, anon;
grant execute on function public.recent_message_count() to authenticated;

-- These guards run with the caller's rights (not security definer): is_direct_client() reads
-- current_user, which inside a definer function would always be the owner.

create or replace function public.guard_message_insert()
returns trigger language plpgsql set search_path = public as $$
declare
  src public.messages;
  src_id uuid;
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
      'source', case
        when src.channel_id is not null then coalesce('#' || (select c.name from public.channels c where c.id = src.channel_id), 'a channel')
        else 'a direct message'
      end
    );
  end if;
  return new;
end $$;
drop trigger if exists messages_guard_insert on public.messages;
create trigger messages_guard_insert before insert on public.messages
  for each row execute function public.guard_message_insert();

-- 1. A direct edit may change the text only; the edit time is set here.
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
     or new.forward_snapshot is distinct from old.forward_snapshot then
    raise exception 'only the message text can be edited';
  end if;
  new.content := public.strip_message_controls(new.content);
  new.updated_at := case when new.content is distinct from old.content then now() else old.updated_at end;
  return new;
end $$;
drop trigger if exists messages_guard_update on public.messages;
create trigger messages_guard_update before update on public.messages
  for each row execute function public.guard_message_update();

-- ---------- 6. attachments bucket ----------

update storage.buckets
  set allowed_mime_types = array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/octet-stream']
  where id = 'attachments';
