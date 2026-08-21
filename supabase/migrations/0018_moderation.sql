-- Moderation: kick / ban / timeout. Widens role permissions, adds bans + timeout,
-- helper predicates, and SECURITY DEFINER mutation RPCs enforcing permission + hierarchy.

-- 1. Widen the roles permission allowlist (superset of 0012).
alter table public.roles drop constraint if exists roles_valid_permissions;
alter table public.roles add constraint roles_valid_permissions check (
  permissions <@ array['manage_channels','manage_server','manage_roles',
    'kick_members','ban_members','timeout_members','manage_messages']::text[]
);

-- 2. Owner's effective permissions must include the two new ones (0014 hardcoded five).
create or replace function public.my_permissions(srv uuid)
returns text[] language sql security definer set search_path = public stable as $$
  select case
    when exists (select 1 from public.servers s where s.id = srv and s.owner_id = auth.uid())
      then array['manage_channels','manage_server','manage_roles',
                 'kick_members','ban_members','timeout_members','manage_messages']::text[]
    else coalesce((
      select array_agg(distinct p)
      from public.member_roles mr
      join public.roles r on r.id = mr.role_id
      cross join lateral unnest(r.permissions) as p
      where mr.server_id = srv and mr.user_id = auth.uid()
    ), array[]::text[])
  end;
$$;

-- 3. Timeout column on membership.
alter table public.server_members add column if not exists timeout_until timestamptz;

-- 4. Bans table.
create table if not exists public.bans (
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  banned_by uuid references public.profiles(id),
  reason    text,
  created_at timestamptz not null default now(),
  primary key (server_id, user_id)
);
alter table public.bans enable row level security;

-- 5. Predicate helpers (SECURITY DEFINER).
create or replace function public.is_banned(srv uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.bans where server_id = srv and user_id = auth.uid());
$$;
grant execute on function public.is_banned(uuid) to authenticated;

create or replace function public.is_timed_out(srv uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.server_members
    where server_id = srv and user_id = auth.uid()
      and timeout_until is not null and timeout_until > now()
  );
$$;
grant execute on function public.is_timed_out(uuid) to authenticated;

create or replace function public.is_timed_out_channel(chan uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select public.is_timed_out((select server_id from public.channels where id = chan));
$$;
grant execute on function public.is_timed_out_channel(uuid) to authenticated;

create or replace function public.is_timed_out_message(msg uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select public.is_timed_out((
    select c.server_id from public.messages m
    join public.channels c on c.id = m.channel_id
    where m.id = msg
  ));
$$;
grant execute on function public.is_timed_out_message(uuid) to authenticated;
-- Note: is_timed_out(null) → the inner exists() is false, so DM messages (no channel) are never timed out.

-- 6. Hierarchy: target's top role rank (roleless → -1), and the moderation gate.
create or replace function public.server_role_rank(srv uuid, uid uuid)
returns int language sql security definer set search_path = public stable as $$
  select coalesce(max(r.position), -1)
  from public.member_roles mr
  join public.roles r on r.id = mr.role_id
  where mr.server_id = srv and mr.user_id = uid;
$$;
grant execute on function public.server_role_rank(uuid, uuid) to authenticated;

create or replace function public.can_moderate(srv uuid, target uuid, perm text)
returns boolean language sql security definer set search_path = public stable as $$
  select
    target <> auth.uid()
    and target <> coalesce((select owner_id from public.servers where id = srv), '00000000-0000-0000-0000-000000000000'::uuid)
    and (
      exists (select 1 from public.servers s where s.id = srv and s.owner_id = auth.uid())
      or (
        public.has_server_permission(srv, perm)
        and public.server_role_rank(srv, auth.uid()) > public.server_role_rank(srv, target)
      )
    );
$$;
grant execute on function public.can_moderate(uuid, uuid, text) to authenticated;

-- 7. Mutation RPCs (enforce permission + hierarchy; raise on violation).
create or replace function public.kick_member(srv uuid, target uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_moderate(srv, target, 'kick_members') then
    raise exception 'not permitted';
  end if;
  delete from public.server_members where server_id = srv and user_id = target;
  delete from public.member_roles where server_id = srv and user_id = target;
end;
$$;
grant execute on function public.kick_member(uuid, uuid) to authenticated;

create or replace function public.ban_member(srv uuid, target uuid, reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_moderate(srv, target, 'ban_members') then
    raise exception 'not permitted';
  end if;
  insert into public.bans (server_id, user_id, banned_by, reason)
    values (srv, target, auth.uid(), reason)
    on conflict (server_id, user_id) do update
      set reason = excluded.reason, banned_by = excluded.banned_by;
  delete from public.server_members where server_id = srv and user_id = target;
  delete from public.member_roles where server_id = srv and user_id = target;
end;
$$;
grant execute on function public.ban_member(uuid, uuid, text) to authenticated;

create or replace function public.unban_member(srv uuid, target uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (
    exists (select 1 from public.servers s where s.id = srv and s.owner_id = auth.uid())
    or public.has_server_permission(srv, 'ban_members')
  ) then
    raise exception 'not permitted';
  end if;
  delete from public.bans where server_id = srv and user_id = target;
end;
$$;
grant execute on function public.unban_member(uuid, uuid) to authenticated;

create or replace function public.timeout_member(srv uuid, target uuid, until timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_moderate(srv, target, 'timeout_members') then
    raise exception 'not permitted';
  end if;
  update public.server_members set timeout_until = until
    where server_id = srv and user_id = target;
end;
$$;
grant execute on function public.timeout_member(uuid, uuid, timestamptz) to authenticated;

-- 8. RLS: block rejoin while banned; keep the private-server (invite-only) gate.
drop policy if exists "self join server" on public.server_members;
create policy "self join server" on public.server_members for insert to authenticated
  with check (
    user_id = auth.uid()
    and not public.is_banned(server_id)
    and exists (select 1 from public.servers s where s.id = server_id and s.is_public)
  );

-- 9. RLS: timed-out users can't send messages (channels only; DMs unaffected).
drop policy if exists "send messages" on public.messages;
create policy "send messages" on public.messages for insert to authenticated
  with check (
    author_id = auth.uid() and (
      (channel_id is not null and public.is_channel_member(channel_id)
        and not public.is_timed_out_channel(channel_id))
      or (conversation_id is not null and public.is_conversation_member(conversation_id))
    )
  );

-- 10. RLS: timed-out users can't add reactions.
drop policy if exists "add own reactions" on public.reactions;
create policy "add own reactions" on public.reactions for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.can_read_message(message_id)
    and not public.is_timed_out_message(message_id)
  );

-- 11. RLS: bans readable by ban_members holders / owner (for the Banned list).
create policy "read bans (ban_members)" on public.bans for select to authenticated
  using (
    public.has_server_permission(server_id, 'ban_members')
    or server_id in (select id from public.servers where owner_id = auth.uid())
  );
