-- role column
alter table public.server_members
  add column if not exists role text not null default 'member' check (role in ('admin','member'));

-- owner OR admin
create or replace function public.is_server_admin(srv uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from public.servers s where s.id = srv and s.owner_id = auth.uid())
      or exists (select 1 from public.server_members m
                 where m.server_id = srv and m.user_id = auth.uid() and m.role = 'admin');
$$;

-- tighten self-join: a joining user cannot self-assign admin
drop policy if exists "self join server" on public.server_members;
create policy "self join server" on public.server_members for insert to authenticated
  with check (user_id = auth.uid() and role = 'member');

-- role management: owner + admins may update roles
drop policy if exists "manage member roles" on public.server_members;
create policy "manage member roles" on public.server_members for update to authenticated
  using (public.is_server_admin(server_id)) with check (public.is_server_admin(server_id));

-- channels: management gated to admins (replaces the member-level policies from 0005)
drop policy if exists "members insert channels" on public.channels;
drop policy if exists "members update channels" on public.channels;
drop policy if exists "members delete channels" on public.channels;
create policy "admins insert channels" on public.channels for insert to authenticated with check (public.is_server_admin(server_id));
create policy "admins update channels" on public.channels for update to authenticated using (public.is_server_admin(server_id));
create policy "admins delete channels" on public.channels for delete to authenticated using (public.is_server_admin(server_id));

-- categories: management gated to admins
drop policy if exists "members insert categories" on public.categories;
drop policy if exists "members update categories" on public.categories;
drop policy if exists "members delete categories" on public.categories;
create policy "admins insert categories" on public.categories for insert to authenticated with check (public.is_server_admin(server_id));
create policy "admins update categories" on public.categories for update to authenticated using (public.is_server_admin(server_id));
create policy "admins delete categories" on public.categories for delete to authenticated using (public.is_server_admin(server_id));

-- server rename/icon gated to admins
drop policy if exists "members update server" on public.servers;
create policy "admins update server" on public.servers for update to authenticated using (public.is_server_admin(id));

-- delete the legacy ownerless "Our Server" (cascades channels/messages/categories/memberships)
delete from public.servers where owner_id is null;
