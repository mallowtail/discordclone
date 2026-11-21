-- Privacy & safety: block / ignore, who can DM you (or add you to group chats), and who can send
-- you friend requests. All enforced here, so none of it can be bypassed by calling the API directly.
--
--   Block:  they can't DM you, send friend requests, or add you to groups; any friendship between
--           you is removed; you can't message them either while they're blocked. They aren't told.
--   Ignore: only hides their messages for you (in the app); nothing changes for them.
--   DMs:    'reachable' (default, as before: friends, shared server, or shared DM/group),
--           'friends', or 'none'. Applies to starting DMs, sending in existing 1:1 DMs, and being
--           added to group chats.
--   Friend requests: from everyone (default), friends of friends, and/or people in your servers.

alter table public.profiles
  add column dm_policy text not null default 'reachable' check (dm_policy in ('reachable', 'friends', 'none')),
  add column fr_everyone boolean not null default true,
  add column fr_friends_of_friends boolean not null default true,
  add column fr_server_members boolean not null default true;

create table public.user_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker uuid not null references public.profiles(id) on delete cascade,
  blocked uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('block', 'ignore')),
  created_at timestamptz not null default now(),
  unique (blocker, blocked),
  check (blocker <> blocked)
);
alter table public.user_blocks enable row level security;
-- Your own list only: nobody can find out who has blocked them. Writes go through block_user().
create policy "read own blocks" on public.user_blocks for select to authenticated
  using (blocker = auth.uid());

-- ---------- helpers (definer: they look at rows the caller can't read directly) ----------

create or replace function public.are_friends(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted' and ((f.requester = $1 and f.addressee = $2) or (f.requester = $2 and f.addressee = $1))
  );
$$;

create or replace function public.is_blocked_pair(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_blocks x
    where x.kind = 'block' and ((x.blocker = $1 and x.blocked = $2) or (x.blocker = $2 and x.blocked = $1))
  );
$$;

create or replace function public.share_server(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.server_members m1 join public.server_members m2 on m2.server_id = m1.server_id
    where m1.user_id = $1 and m2.user_id = $2
  );
$$;

create or replace function public.share_conversation(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversation_members m1 join public.conversation_members m2 on m2.conversation_id = m1.conversation_id
    where m1.user_id = $1 and m2.user_id = $2
  );
$$;

-- Can the caller DM `other` / add them to a group? (Used by get_or_create_dm, create_group,
-- add_group_members, the people picker, and sending in 1:1 DMs.) Now also respects blocks and the
-- other person's DM setting.
create or replace function public.can_reach(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and $1 is not null and $1 <> auth.uid()
    and not public.is_blocked_pair(auth.uid(), $1)
    and case (select p.dm_policy from public.profiles p where p.id = $1)
      when 'none' then false
      when 'friends' then public.are_friends(auth.uid(), $1)
      when 'reachable' then public.are_friends(auth.uid(), $1) or public.share_server(auth.uid(), $1) or public.share_conversation(auth.uid(), $1)
      else false
    end;
$$;
grant execute on function public.can_reach(uuid) to authenticated;

-- The picker only lists people you could actually message or add.
create or replace function public.reachable_people()
returns setof public.profiles language sql stable security definer set search_path = public as $$
  with ids as (
    select case when f.requester = auth.uid() then f.addressee else f.requester end as id
    from public.friendships f
    where f.status = 'accepted' and (f.requester = auth.uid() or f.addressee = auth.uid())
    union
    select b.user_id from public.server_members a
    join public.server_members b on b.server_id = a.server_id
    where a.user_id = auth.uid()
    union
    select b.user_id from public.conversation_members a
    join public.conversation_members b on b.conversation_id = a.conversation_id
    where a.user_id = auth.uid()
  )
  select p.* from public.profiles p
  where p.id in (select id from ids) and p.id <> auth.uid() and public.can_reach(p.id)
  order by lower(p.display_name);
$$;

-- ---------- sending in 1:1 DMs ----------

-- Group chats aren't limited (blocks there just hide messages in the app, like Discord); a 1:1 DM
-- needs can_reach() to the other person, so their DM setting and blocks apply to existing DMs too.
create or replace function public.dm_send_allowed(conv uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare other uuid;
begin
  if exists (select 1 from public.conversations c where c.id = conv and c.is_group) then
    return true;
  end if;
  select m.user_id into other from public.conversation_members m where m.conversation_id = conv and m.user_id <> auth.uid() limit 1;
  return other is null or public.can_reach(other);
end $$;
grant execute on function public.dm_send_allowed(uuid) to authenticated;

create or replace function public.guard_dm_permission()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.conversation_id is not null and not public.dm_send_allowed(new.conversation_id) then
    raise exception 'cannot message this person';
  end if;
  return new;
end $$;
drop trigger if exists messages_dm_permission on public.messages;
create trigger messages_dm_permission before insert on public.messages
  for each row execute function public.guard_dm_permission();

-- ---------- friend requests ----------

-- Same as 0029, plus blocks and the target's friend-request setting. Accepting a request they
-- already sent you is always allowed. Refusals don't say why (a block mustn't be detectable).
create or replace function public.send_friend_request(target uuid)
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); existing public.friendships; lo uuid; hi uuid; t public.profiles;
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  if target = me then
    raise exception 'cannot friend yourself';
  end if;
  select * into t from public.profiles p where p.id = target;
  if not found then
    raise exception 'user not found';
  end if;
  if public.is_blocked_pair(me, target) then
    raise exception 'not accepting friend requests';
  end if;
  -- Serialize the two people sending each other a request at the same moment.
  lo := least(me, target);
  hi := greatest(me, target);
  perform pg_advisory_xact_lock(hashtextextended('friend:' || lo::text || ':' || hi::text, 0));
  select * into existing from public.friendships f
    where (f.requester = me and f.addressee = target) or (f.requester = target and f.addressee = me);
  if found then
    if existing.status = 'accepted' then
      return 'already_friends';
    end if;
    if existing.requester = me then
      return 'already_requested';
    end if;
    update public.friendships f set status = 'accepted', accepted_at = now()
      where f.requester = target and f.addressee = me;
    return 'accepted';
  end if;
  if not (
    t.fr_everyone
    or (t.fr_server_members and public.share_server(me, target))
    or (t.fr_friends_of_friends and exists (
      select 1 from public.friendships a
      join public.friendships b on b.status = 'accepted'
        and (case when b.requester = target then b.addressee else b.requester end)
          = (case when a.requester = me then a.addressee else a.requester end)
        and (b.requester = target or b.addressee = target)
      where a.status = 'accepted' and (a.requester = me or a.addressee = me)
    ))
  ) then
    raise exception 'not accepting friend requests';
  end if;
  insert into public.friendships (requester, addressee) values (me, target);
  return 'requested';
end $$;

-- ---------- block / ignore ----------

-- kind 'block' or 'ignore'; switching between them updates the row. Blocking removes any
-- friendship or pending request between the two.
create or replace function public.block_user(target uuid, block_kind text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or target is null or target = me then
    raise exception 'invalid target';
  end if;
  if block_kind not in ('block', 'ignore') then
    raise exception 'invalid kind';
  end if;
  if not exists (select 1 from public.profiles p where p.id = target) then
    raise exception 'user not found';
  end if;
  insert into public.user_blocks (blocker, blocked, kind) values (me, target, block_kind)
    on conflict (blocker, blocked) do update set kind = excluded.kind, created_at = now();
  if block_kind = 'block' then
    delete from public.friendships f
      where (f.requester = me and f.addressee = target) or (f.requester = target and f.addressee = me);
  end if;
end $$;
grant execute on function public.block_user(uuid, text) to authenticated;

create or replace function public.unblock_user(target uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.user_blocks x where x.blocker = auth.uid() and x.blocked = $1;
$$;
grant execute on function public.unblock_user(uuid) to authenticated;

-- The building-block helpers would answer questions about other people ("did X block Y?", "are X
-- and Y friends?", "is X in that server?") if callable directly, so only the definer functions above
-- (which run as their owner) may use them.
revoke execute on function public.are_friends(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.is_blocked_pair(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.share_server(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.share_conversation(uuid, uuid) from public, anon, authenticated;
