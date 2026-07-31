-- ===== helper functions (SECURITY DEFINER: read roles/member_roles without RLS recursion) =====

-- caller's highest role position in a server (NULL if they hold no roles)
create or replace function public.my_role_rank(srv uuid)
returns int language sql security definer set search_path = public stable as $$
  select max(r.position)
  from public.member_roles mr
  join public.roles r on r.id = mr.role_id
  where mr.server_id = srv and mr.user_id = auth.uid();
$$;
grant execute on function public.my_role_rank(uuid) to authenticated;

-- caller's effective permissions (owner → all five; else the union of their roles')
create or replace function public.my_permissions(srv uuid)
returns text[] language sql security definer set search_path = public stable as $$
  select case
    when exists (select 1 from public.servers s where s.id = srv and s.owner_id = auth.uid())
      then array['manage_channels','manage_server','manage_roles','kick_members','manage_messages']::text[]
    else coalesce((
      select array_agg(distinct p)
      from public.member_roles mr
      join public.roles r on r.id = mr.role_id
      cross join lateral unnest(r.permissions) as p
      where mr.server_id = srv and mr.user_id = auth.uid()
    ), array[]::text[])
  end;
$$;
grant execute on function public.my_permissions(uuid) to authenticated;

-- can the caller create/edit/delete a role AT target_position WITH target_perms?
create or replace function public.can_manage_role(srv uuid, target_position int, target_perms text[])
returns boolean language sql security definer set search_path = public stable as $$
  select
    exists (select 1 from public.servers s where s.id = srv and s.owner_id = auth.uid())
    or (
      'manage_roles' = any(public.my_permissions(srv))
      and public.my_role_rank(srv) is not null
      and target_position < public.my_role_rank(srv)
      and target_perms <@ public.my_permissions(srv)
    );
$$;
grant execute on function public.can_manage_role(uuid, int, text[]) to authenticated;

-- can the caller assign/unassign a given role? owner bypass; else manage_roles + role below rank.
create or replace function public.can_assign_role(srv uuid, rid uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select
    exists (select 1 from public.servers s where s.id = srv and s.owner_id = auth.uid())
    or (
      'manage_roles' = any(public.my_permissions(srv))
      and public.my_role_rank(srv) is not null
      and exists (
        select 1 from public.roles r
        where r.id = rid and r.server_id = srv and r.position < public.my_role_rank(srv)
      )
    );
$$;
grant execute on function public.can_assign_role(uuid, uuid) to authenticated;

-- ===== roles: hierarchy-aware management (replaces D2's flat manage_roles policies) =====
drop policy if exists "insert roles" on public.roles;
drop policy if exists "update roles" on public.roles;
drop policy if exists "delete roles" on public.roles;
create policy "insert roles" on public.roles for insert to authenticated
  with check (public.can_manage_role(server_id, position, permissions));
create policy "update roles" on public.roles for update to authenticated
  using (public.can_manage_role(server_id, position, permissions))
  with check (public.can_manage_role(server_id, position, permissions));
create policy "delete roles" on public.roles for delete to authenticated
  using (public.can_manage_role(server_id, position, permissions));

-- ===== member_roles: hierarchy-aware assignment =====
drop policy if exists "insert member_roles" on public.member_roles;
drop policy if exists "delete member_roles" on public.member_roles;
create policy "insert member_roles" on public.member_roles for insert to authenticated
  with check (public.can_assign_role(server_id, role_id));
create policy "delete member_roles" on public.member_roles for delete to authenticated
  using (public.can_assign_role(server_id, role_id));
