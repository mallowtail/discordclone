-- 0050: a "Change Server Icon" role permission (`manage_server_icon`).
--
-- 1. New permission key; the owner always has it (has_server_permission already treats the owner
--    as having everything, and my_permissions lists it for the owner). Roles with manage_server
--    get it on day one.
-- 2. Server icons now live in a folder per server: `server-icons/<server_id>/<random>.<ext>`.
--    Uploading or deleting a file there needs manage_server_icon in THAT server (replaces 0006's
--    "any signed-in user may upload" and 0049's "only the uploader may delete").
-- 3. servers.icon_url must point inside the server's own folder (it used to accept any flat file
--    in the bucket, so a manager could point their server at another server's icon).
-- 4. manage_server_icon holders may update their server, but a guard trigger lets them change
--    only icon_url; every other column still needs manage_server. protect_server_owner is
--    unchanged.
-- Production had no storage files, so nothing needs moving.

-- ---------- 1. permission ----------
alter table public.roles drop constraint if exists roles_valid_permissions;
alter table public.roles add constraint roles_valid_permissions check (
  permissions <@ array['manage_channels','manage_server','manage_roles',
    'kick_members','ban_members','timeout_members','manage_messages','manage_stickers',
    'manage_server_icon']::text[]
);

-- Same as 0044, plus manage_server_icon for the owner.
create or replace function public.my_permissions(srv uuid)
returns text[] language sql security definer set search_path = public stable as $$
  select case
    when exists (select 1 from public.servers s where s.id = srv and s.owner_id = auth.uid())
      then array['manage_channels','manage_server','manage_roles',
                 'kick_members','ban_members','timeout_members','manage_messages','manage_stickers',
                 'manage_server_icon']::text[]
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
update public.roles set permissions = permissions || array['manage_server_icon']
  where 'manage_server' = any(permissions) and not 'manage_server_icon' = any(permissions);

-- ---------- 2. storage ----------
-- The first folder of a storage path `<uuid>/<file>` as a uuid; null when there is no folder or it
-- isn't a uuid (so a policy refuses instead of erroring). Same body as sticker_folder_server (0045).
create or replace function public.storage_folder_uuid(object_name text)
returns uuid language plpgsql immutable
set search_path = public
as $$
declare
  folder text := split_part(coalesce(object_name, ''), '/', 1);
begin
  if position('/' in coalesce(object_name, '')) = 0
     or folder !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return null;
  end if;
  return folder::uuid;
end $$;

drop policy if exists "authenticated upload server-icons" on storage.objects;
drop policy if exists "icon managers upload server-icons" on storage.objects;
create policy "icon managers upload server-icons"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'server-icons'
    and public.has_server_permission(public.storage_folder_uuid(name), 'manage_server_icon'));

drop policy if exists "uploaders delete server-icons" on storage.objects;
drop policy if exists "icon managers delete server-icons" on storage.objects;
create policy "icon managers delete server-icons"
  on storage.objects for delete to authenticated
  using (bucket_id = 'server-icons'
    and public.has_server_permission(public.storage_folder_uuid(name), 'manage_server_icon'));

-- ---------- 3. icon_url stays inside the server's own folder ----------
alter table public.servers drop constraint if exists servers_icon_url;
alter table public.servers add constraint servers_icon_url check (
  icon_url is null
  or icon_url ~ ('^https://dpsikhsxdwigeuyonfch\.supabase\.co/storage/v1/object/public/server-icons/'
                 || id::text || '/[A-Za-z0-9_-]+\.[A-Za-z0-9]+$')
);

-- ---------- 4. who may update a server ----------
drop policy if exists "update server" on public.servers;
create policy "update server" on public.servers for update to authenticated
  using (public.has_server_permission(id, 'manage_server')
      or public.has_server_permission(id, 'manage_server_icon'));

-- Someone with only manage_server_icon may change icon_url and nothing else. Only checked for the
-- app's own users (is_direct_client, 0032), so security-definer functions are unaffected.
create or replace function public.guard_server_update()
returns trigger language plpgsql as $$
begin
  if public.is_direct_client()
     and (to_jsonb(new) - 'icon_url') is distinct from (to_jsonb(old) - 'icon_url')
     and not public.has_server_permission(old.id, 'manage_server') then
    raise exception 'you can only change the server icon';
  end if;
  return new;
end $$;

drop trigger if exists servers_guard_update on public.servers;
create trigger servers_guard_update before update on public.servers
  for each row execute function public.guard_server_update();
