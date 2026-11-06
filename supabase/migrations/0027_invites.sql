-- Per-invite links. Any member can create invites with an optional expiry and use limit (a limit
-- of 1 is a one-time link), and each server's owner can set one optional custom ("vanity") code.
-- Codes are matched case-insensitively: `Mallow-Gang` and `mallow-gang` are the same invite.
--
-- Naming trap: the functions below take an argument called `code` (kept for the existing client
-- calls), and invites also has a `code` column. Inside them the bare name would resolve to the
-- column, so the argument is always referenced positionally as $1.

create table public.invites (
  code text primary key check (code ~ '^[A-Za-z0-9-]{2,32}$'),
  server_id uuid not null references public.servers(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  max_uses integer check (max_uses is null or max_uses > 0),
  uses integer not null default 0 check (uses >= 0),
  is_vanity boolean not null default false
);
create unique index invites_code_ci on public.invites (lower(code));
create unique index invites_one_vanity_per_server on public.invites (server_id) where is_vanity;
create index invites_server on public.invites (server_id);

alter table public.invites enable row level security;
-- Members can read their server's invites (the managers' list). Every write goes through the
-- security-definer functions below, so there are deliberately no insert/update/delete policies.
create policy "members read server invites" on public.invites for select to authenticated
  using (public.is_server_member(server_id));

-- Every server's existing random link becomes an ordinary never-expiring, unlimited invite, so
-- links already shared keep working. servers.invite_code stays as a legacy column, no longer read.
insert into public.invites (code, server_id, created_by)
select s.invite_code, s.id, s.owner_id
from public.servers s
where s.invite_code is not null;

-- New servers get a default invite row too (same never-expiring behaviour as before).
create or replace function public.create_server(server_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare srv uuid; cat uuid; c text;
begin
  c := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  insert into public.servers (name, owner_id, invite_code)
    values (server_name, auth.uid(), c)
    returning id into srv;
  insert into public.server_members (server_id, user_id) values (srv, auth.uid());
  insert into public.categories (server_id, name, position) values (srv, 'Text Channels', 0) returning id into cat;
  insert into public.channels (name, position, server_id, category_id) values ('general', 0, srv, cat);
  insert into public.invites (code, server_id, created_by) values (c, srv, auth.uid());
  return srv;
end $$;
grant execute on function public.create_server(text) to authenticated;

-- Any member can create an invite. expires_in is in seconds (null = never); use_limit null = no limit.
create or replace function public.create_invite(srv uuid, expires_in integer default 604800, use_limit integer default null)
returns text language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.is_server_member(srv) then
    raise exception 'not authorized';
  end if;
  if expires_in is not null and expires_in <= 0 then
    raise exception 'invalid expiry';
  end if;
  if use_limit is not null and use_limit <= 0 then
    raise exception 'invalid use limit';
  end if;
  c := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  insert into public.invites (code, server_id, created_by, expires_at, max_uses)
    values (
      c, srv, auth.uid(),
      case when expires_in is null then null else now() + make_interval(secs => expires_in) end,
      use_limit
    );
  return c;
end $$;
grant execute on function public.create_invite(uuid, integer, integer) to authenticated;

-- Server managers (manage_server; the owner always has it) can revoke a regular invite.
-- The custom link is changed or removed through set_vanity_invite instead.
create or replace function public.revoke_invite(invite_code text)
returns void language plpgsql security definer set search_path = public as $$
declare inv public.invites;
begin
  select * into inv from public.invites i where lower(i.code) = lower($1);
  if not found then
    raise exception 'invalid invite code';
  end if;
  if inv.is_vanity then
    raise exception 'use set_vanity_invite to change the custom link';
  end if;
  if not public.has_server_permission(inv.server_id, 'manage_server') then
    raise exception 'not authorized';
  end if;
  delete from public.invites i where i.code = inv.code;
end $$;
grant execute on function public.revoke_invite(text) to authenticated;

-- The owner sets (or, with null / empty, removes) the server's single custom link.
-- If the new code is taken, the exception handler rolls back the delete, so the old link survives.
create or replace function public.set_vanity_invite(srv uuid, vanity text)
returns text language plpgsql security definer set search_path = public as $$
declare v text := btrim(coalesce(vanity, ''));
begin
  if not exists (select 1 from public.servers s where s.id = srv and s.owner_id = auth.uid()) then
    raise exception 'only the server owner can set a custom link';
  end if;
  delete from public.invites i where i.server_id = srv and i.is_vanity;
  if v = '' then
    return null;
  end if;
  if v !~ '^[A-Za-z0-9-]{2,32}$' then
    raise exception 'invalid custom link';
  end if;
  insert into public.invites (code, server_id, created_by, is_vanity) values (v, srv, auth.uid(), true);
  return v;
exception
  when unique_violation then
    raise exception 'custom link taken';
end $$;
grant execute on function public.set_vanity_invite(uuid, text) to authenticated;

-- Invite landing-page preview. Now also reports whether the invite is still usable, so the page can
-- say "expired" rather than "invalid". The return shape changed, so the old function is dropped first.
drop function if exists public.server_by_invite(text);
create function public.server_by_invite(code text)
returns table(id uuid, name text, icon_url text, member_count bigint, status text)
language sql security definer set search_path = public stable as $$
  select s.id, s.name, s.icon_url,
         (select count(*) from public.server_members m where m.server_id = s.id) as member_count,
         case
           when i.expires_at is not null and i.expires_at <= now() then 'expired'
           when i.max_uses is not null and i.uses >= i.max_uses then 'used_up'
           else 'ok'
         end as status
  from public.invites i
  join public.servers s on s.id = i.server_id
  where lower(i.code) = lower($1);
$$;
grant execute on function public.server_by_invite(text) to authenticated;

-- Join through an invite. The row is locked FOR UPDATE, so two people racing for the last use of a
-- one-time link can't both get in. Only a genuinely new membership spends a use.
create or replace function public.join_via_invite(code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare inv public.invites; joined integer;
begin
  select * into inv from public.invites i where lower(i.code) = lower($1) for update;
  if not found then
    raise exception 'invalid invite code';
  end if;
  -- Already in the server: reopening a link is a no-op, even if that link has since expired or
  -- been used up (e.g. the person who just spent a one-time link clicking it again).
  if exists (select 1 from public.server_members m where m.server_id = inv.server_id and m.user_id = auth.uid()) then
    return inv.server_id;
  end if;
  if inv.expires_at is not null and inv.expires_at <= now() then
    raise exception 'invite expired';
  end if;
  if inv.max_uses is not null and inv.uses >= inv.max_uses then
    raise exception 'invite used up';
  end if;
  if public.is_banned(inv.server_id) then
    raise exception 'banned from this server';
  end if;
  insert into public.server_members (server_id, user_id, role)
    values (inv.server_id, auth.uid(), 'member')
    on conflict (server_id, user_id) do nothing;
  get diagnostics joined = row_count;
  if joined > 0 then
    update public.invites i set uses = i.uses + 1 where i.code = inv.code;
  end if;
  return inv.server_id;
end $$;
grant execute on function public.join_via_invite(text) to authenticated;

-- Replaced by per-invite links (managers revoke individual invites instead of regenerating one code).
drop function if exists public.regenerate_invite(uuid);
