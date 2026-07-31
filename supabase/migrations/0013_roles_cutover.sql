-- ===== 1. remove the seeded Admin roles (assignments cascade) =====
delete from public.roles
where name = 'Admin'
  and permissions @> array['manage_channels','manage_server','manage_roles','kick_members','manage_messages']::text[]
  and permissions <@ array['manage_channels','manage_server','manage_roles','kick_members','manage_messages']::text[];

-- ===== 2. channels: manage_channels =====
drop policy if exists "admins insert channels" on public.channels;
drop policy if exists "admins update channels" on public.channels;
drop policy if exists "admins delete channels" on public.channels;
create policy "insert channels" on public.channels for insert to authenticated with check (public.has_server_permission(server_id, 'manage_channels'));
create policy "update channels" on public.channels for update to authenticated using (public.has_server_permission(server_id, 'manage_channels'));
create policy "delete channels" on public.channels for delete to authenticated using (public.has_server_permission(server_id, 'manage_channels'));

-- ===== 3. categories: manage_channels =====
drop policy if exists "admins insert categories" on public.categories;
drop policy if exists "admins update categories" on public.categories;
drop policy if exists "admins delete categories" on public.categories;
create policy "insert categories" on public.categories for insert to authenticated with check (public.has_server_permission(server_id, 'manage_channels'));
create policy "update categories" on public.categories for update to authenticated using (public.has_server_permission(server_id, 'manage_channels'));
create policy "delete categories" on public.categories for delete to authenticated using (public.has_server_permission(server_id, 'manage_channels'));

-- ===== 4. servers: manage_server =====
drop policy if exists "admins update server" on public.servers;
create policy "update server" on public.servers for update to authenticated using (public.has_server_permission(id, 'manage_server'));

-- ===== 5. roles: manage_roles (replaces the D1 is_server_admin stand-in) =====
drop policy if exists "admins insert roles" on public.roles;
drop policy if exists "admins update roles" on public.roles;
drop policy if exists "admins delete roles" on public.roles;
create policy "insert roles" on public.roles for insert to authenticated with check (public.has_server_permission(server_id, 'manage_roles'));
create policy "update roles" on public.roles for update to authenticated using (public.has_server_permission(server_id, 'manage_roles'));
create policy "delete roles" on public.roles for delete to authenticated using (public.has_server_permission(server_id, 'manage_roles'));

-- ===== 6. member_roles: manage_roles =====
drop policy if exists "admins insert member_roles" on public.member_roles;
drop policy if exists "admins delete member_roles" on public.member_roles;
create policy "insert member_roles" on public.member_roles for insert to authenticated with check (public.has_server_permission(server_id, 'manage_roles'));
create policy "delete member_roles" on public.member_roles for delete to authenticated using (public.has_server_permission(server_id, 'manage_roles'));

-- ===== 7. drop the tier-management policy (server_members.role no longer grants anything) =====
drop policy if exists "manage member roles" on public.server_members;

-- ===== 8. regenerate_invite now needs manage_server =====
create or replace function public.regenerate_invite(srv uuid)
returns text language plpgsql security definer set search_path = public as $$
declare code text;
begin
  if not public.has_server_permission(srv, 'manage_server') then
    raise exception 'not authorized';
  end if;
  code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  update public.servers set invite_code = code where id = srv;
  return code;
end $$;
grant execute on function public.regenerate_invite(uuid) to authenticated;
