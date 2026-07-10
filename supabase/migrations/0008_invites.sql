-- ===== visibility + invite code columns =====
alter table public.servers add column if not exists is_public boolean not null default true;
alter table public.servers add column if not exists invite_code text unique;

-- backfill invite codes for existing servers
update public.servers
  set invite_code = substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)
  where invite_code is null;

-- ===== servers SELECT: public OR member (replaces the open "using (true)") =====
drop policy if exists "servers readable by authenticated" on public.servers;
create policy "read public or member servers" on public.servers for select to authenticated
  using (is_public or public.is_server_member(id));

-- ===== self-join tightened to PUBLIC servers only =====
drop policy if exists "self join server" on public.server_members;
create policy "self join server" on public.server_members for insert to authenticated
  with check (
    user_id = auth.uid()
    and role = 'member'
    and exists (select 1 from public.servers s where s.id = server_id and s.is_public)
  );

-- ===== create_server: set an invite code on creation =====
create or replace function public.create_server(server_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare srv uuid; cat uuid;
begin
  insert into public.servers (name, owner_id, invite_code)
    values (server_name, auth.uid(), substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
    returning id into srv;
  insert into public.server_members (server_id, user_id) values (srv, auth.uid());
  insert into public.categories (server_id, name, position) values (srv, 'Text Channels', 0) returning id into cat;
  insert into public.channels (name, position, server_id, category_id) values ('general', 0, srv, cat);
  return srv;
end $$;
grant execute on function public.create_server(text) to authenticated;

-- ===== server_by_invite: preview for non-members (definer bypasses SELECT policy) =====
create or replace function public.server_by_invite(code text)
returns table(id uuid, name text, icon_url text, member_count bigint)
language sql security definer set search_path = public as $$
  select s.id, s.name, s.icon_url,
         (select count(*) from public.server_members m where m.server_id = s.id) as member_count
  from public.servers s
  where s.invite_code = code;
$$;
grant execute on function public.server_by_invite(text) to authenticated;

-- ===== join_via_invite: join a server by code =====
create or replace function public.join_via_invite(code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare srv uuid;
begin
  select id into srv from public.servers where invite_code = code;
  if srv is null then
    raise exception 'invalid invite code';
  end if;
  insert into public.server_members (server_id, user_id, role)
    values (srv, auth.uid(), 'member')
    on conflict (server_id, user_id) do nothing;
  return srv;
end $$;
grant execute on function public.join_via_invite(text) to authenticated;

-- ===== regenerate_invite: managers roll a new code (kills the old link) =====
create or replace function public.regenerate_invite(srv uuid)
returns text language plpgsql security definer set search_path = public as $$
declare code text;
begin
  if not public.is_server_admin(srv) then
    raise exception 'not authorized';
  end if;
  code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  update public.servers set invite_code = code where id = srv;
  return code;
end $$;
grant execute on function public.regenerate_invite(uuid) to authenticated;
