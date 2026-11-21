-- Server settings overhaul: a server description, and an audit log of moderation actions (kick,
-- ban, unban, timeout) with who did it and why. Kicks and timeouts gain an optional reason.

-- ---------- description ----------
alter table public.servers add column description text check (description is null or char_length(description) <= 300);

create or replace function public.clean_server_description()
returns trigger language plpgsql as $$
begin
  new.description := nullif(btrim(public.strip_invisible(new.description)), '');
  return new;
end $$;
drop trigger if exists servers_clean_description on public.servers;
create trigger servers_clean_description before insert or update of description on public.servers
  for each row execute function public.clean_server_description();

-- ---------- audit log ----------
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  action text not null check (action in ('kick', 'ban', 'unban', 'timeout', 'timeout_removed')),
  actor_id uuid references public.profiles(id) on delete set null,
  target_id uuid references public.profiles(id) on delete set null,
  reason text check (reason is null or char_length(reason) <= 512),
  until timestamptz,
  created_at timestamptz not null default now()
);
create index audit_log_server_time on public.audit_log (server_id, created_at desc);

alter table public.audit_log enable row level security;
-- Readable by the server's owner and anyone who can moderate or manage it. Written only by the
-- moderation functions below (no write policies).
create policy "moderators read audit log" on public.audit_log for select to authenticated
  using (
    exists (select 1 from public.servers s where s.id = server_id and s.owner_id = auth.uid())
    or public.has_server_permission(server_id, 'manage_server')
    or public.has_server_permission(server_id, 'kick_members')
    or public.has_server_permission(server_id, 'ban_members')
    or public.has_server_permission(server_id, 'timeout_members')
  );

create or replace function public.clean_reason(r text)
returns text language sql immutable as $$
  select nullif(left(btrim(public.strip_invisible(coalesce(r, ''))), 512), '');
$$;

-- ---------- moderation functions (same checks as 0018, now logged; kick/timeout take a reason) ----------
drop function if exists public.kick_member(uuid, uuid);
create or replace function public.kick_member(srv uuid, target uuid, reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_moderate(srv, target, 'kick_members') then
    raise exception 'not permitted';
  end if;
  delete from public.server_members m where m.server_id = srv and m.user_id = target;
  delete from public.member_roles r where r.server_id = srv and r.user_id = target;
  insert into public.audit_log (server_id, action, actor_id, target_id, reason)
    values (srv, 'kick', auth.uid(), target, public.clean_reason($3));
end $$;
grant execute on function public.kick_member(uuid, uuid, text) to authenticated;

create or replace function public.ban_member(srv uuid, target uuid, reason text)
returns void language plpgsql security definer set search_path = public as $$
declare r text := public.clean_reason($3);
begin
  if not public.can_moderate(srv, target, 'ban_members') then
    raise exception 'not permitted';
  end if;
  insert into public.bans (server_id, user_id, banned_by, reason)
    values (srv, target, auth.uid(), r)
    on conflict (server_id, user_id) do update
      set reason = excluded.reason, banned_by = excluded.banned_by;
  delete from public.server_members m where m.server_id = srv and m.user_id = target;
  delete from public.member_roles x where x.server_id = srv and x.user_id = target;
  insert into public.audit_log (server_id, action, actor_id, target_id, reason) values (srv, 'ban', auth.uid(), target, r);
end $$;
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
  delete from public.bans b where b.server_id = srv and b.user_id = target;
  if found then
    insert into public.audit_log (server_id, action, actor_id, target_id) values (srv, 'unban', auth.uid(), target);
  end if;
end $$;
grant execute on function public.unban_member(uuid, uuid) to authenticated;

drop function if exists public.timeout_member(uuid, uuid, timestamptz);
create or replace function public.timeout_member(srv uuid, target uuid, until timestamptz, reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_moderate(srv, target, 'timeout_members') then
    raise exception 'not permitted';
  end if;
  update public.server_members m set timeout_until = $3 where m.server_id = srv and m.user_id = target;
  insert into public.audit_log (server_id, action, actor_id, target_id, reason, until)
    values (srv, case when $3 is null then 'timeout_removed' else 'timeout' end, auth.uid(), target, public.clean_reason($4), $3);
end $$;
grant execute on function public.timeout_member(uuid, uuid, timestamptz, text) to authenticated;
