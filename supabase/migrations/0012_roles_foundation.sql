-- roles: named, colored, permission-bearing, per server
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  name text not null,
  color text,
  permissions text[] not null default '{}',
  position int not null default 0,
  created_at timestamptz not null default now(),
  constraint roles_valid_permissions check (
    permissions <@ array['manage_channels','manage_server','manage_roles','kick_members','manage_messages']::text[]
  )
);

-- member_roles: a member can hold multiple roles
create table public.member_roles (
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  primary key (server_id, user_id, role_id)
);

-- permission resolver: owner is a hardcoded super-user; else union of assigned roles' perms
create or replace function public.has_server_permission(srv uuid, perm text)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from public.servers s where s.id = srv and s.owner_id = auth.uid())
      or exists (
        select 1 from public.member_roles mr
        join public.roles r on r.id = mr.role_id
        where mr.server_id = srv and mr.user_id = auth.uid()
          and perm = any(r.permissions)
      );
$$;
grant execute on function public.has_server_permission(uuid, text) to authenticated;

-- RLS: readable by members; management gated by is_server_admin FOR NOW (D2 switches to manage_roles)
alter table public.roles enable row level security;
alter table public.member_roles enable row level security;

create policy "members read roles" on public.roles for select to authenticated
  using (public.is_server_member(server_id));
create policy "admins insert roles" on public.roles for insert to authenticated
  with check (public.is_server_admin(server_id));
create policy "admins update roles" on public.roles for update to authenticated
  using (public.is_server_admin(server_id));
create policy "admins delete roles" on public.roles for delete to authenticated
  using (public.is_server_admin(server_id));

create policy "members read member_roles" on public.member_roles for select to authenticated
  using (public.is_server_member(server_id));
create policy "admins insert member_roles" on public.member_roles for insert to authenticated
  with check (public.is_server_admin(server_id));
create policy "admins delete member_roles" on public.member_roles for delete to authenticated
  using (public.is_server_admin(server_id));

-- realtime
alter publication supabase_realtime add table public.roles;
alter publication supabase_realtime add table public.member_roles;

-- seed: an "Admin" role (all 5 perms) per server, assigned to current admins
do $$
declare s record; rid uuid;
begin
  for s in select id from public.servers loop
    insert into public.roles (server_id, name, color, permissions, position)
      values (s.id, 'Admin', '#7c9cff',
        array['manage_channels','manage_server','manage_roles','kick_members','manage_messages'], 1)
      returning id into rid;
    insert into public.member_roles (server_id, user_id, role_id)
      select s.id, m.user_id, rid
      from public.server_members m
      where m.server_id = s.id and m.role = 'admin';
  end loop;
end $$;
