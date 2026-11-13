-- Group chats: conversations with up to 10 people, a name, and an owner.
--
-- Who you can reach: you can only start a DM or group with, or add to a group, people you already
-- share a place with — friends, a server, or an existing DM/group. Enforced here (can_reach), and
-- the picker lists exactly those people (reachable_people). Existing DMs keep working regardless.
--
-- Ownership: whoever creates a group owns it. The owner can kick people and hand ownership to
-- another member. If the owner leaves without doing that, a random remaining member becomes owner.
-- The last person to leave deletes the group (and its messages).
--
-- Every write goes through the security-definer functions below; the tables have no write policies.
-- Arguments are named so they can't collide with column names (plpgsql errors on ambiguity).

alter table public.conversations
  add column name text check (name is null or char_length(name) between 1 and 100),
  add column owner_id uuid references public.profiles(id) on delete set null;

-- Realtime sends DELETE events to every subscriber regardless of RLS, carrying only the primary
-- key. With (conversation_id, user_id) as the key, anyone could watch who leaves or is kicked from
-- which conversation, so key membership on an opaque id (the pair stays unique). Same as 0030.
alter table public.conversation_members add column id uuid not null default gen_random_uuid();
alter table public.conversation_members drop constraint conversation_members_pkey;
alter table public.conversation_members add primary key (id);
alter table public.conversation_members add constraint conversation_members_pair unique (conversation_id, user_id);

-- Live sidebar and member list: being added, kicked, renamed. Inserts/updates are filtered by the
-- existing "members can read" policies; deletes carry only the opaque id.
alter publication supabase_realtime add table public.conversations, public.conversation_members;

-- Can the caller reach `other`? Friends, a shared server, or a shared conversation.
create or replace function public.can_reach(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and $1 is not null and $1 <> auth.uid() and (
    exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.requester = auth.uid() and f.addressee = $1) or (f.requester = $1 and f.addressee = auth.uid()))
    )
    or exists (
      select 1 from public.server_members a
      join public.server_members b on b.server_id = a.server_id
      where a.user_id = auth.uid() and b.user_id = $1
    )
    or exists (
      select 1 from public.conversation_members a
      join public.conversation_members b on b.conversation_id = a.conversation_id
      where a.user_id = auth.uid() and b.user_id = $1
    )
  );
$$;
grant execute on function public.can_reach(uuid) to authenticated;

-- Everyone the caller can reach, for the new-DM / group picker.
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
  where p.id in (select id from ids) and p.id <> auth.uid()
  order by lower(p.display_name);
$$;
grant execute on function public.reachable_people() to authenticated;

-- Same as 0024, plus: a NEW DM needs the other person to be reachable. An existing DM between the
-- two is still returned no matter what (old conversations keep working).
create or replace function public.get_or_create_dm(other uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me   uuid := auth.uid();
  lo   uuid;
  hi   uuid;
  conv uuid;
begin
  if me is null or other is null or me = other then
    raise exception 'invalid dm target';
  end if;

  lo := least(me, other);
  hi := greatest(me, other);
  -- Serialize concurrent get_or_create for this unordered pair (lock released at commit).
  perform pg_advisory_xact_lock(hashtextextended(lo::text || ':' || hi::text, 0));

  -- Reuse an existing 1-on-1 (non-group) conversation the two of them already share.
  select c.id into conv
  from public.conversations c
  join public.conversation_members m_me    on m_me.conversation_id    = c.id and m_me.user_id    = me
  join public.conversation_members m_other on m_other.conversation_id = c.id and m_other.user_id = other
  where c.is_group = false
  limit 1;

  if conv is not null then
    return conv;
  end if;

  if not public.can_reach(other) then
    raise exception 'not reachable';
  end if;

  conv := gen_random_uuid();
  insert into public.conversations (id, is_group) values (conv, false);
  insert into public.conversation_members (conversation_id, user_id) values (conv, me), (conv, other);
  return conv;
end;
$$;
grant execute on function public.get_or_create_dm(uuid) to authenticated;

-- Start a group with 2–9 other people (10 including you). You become the owner.
create or replace function public.create_group(people uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  others uuid[];
  p uuid;
  conv uuid;
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  select coalesce(array_agg(distinct x), '{}') into others from unnest(people) as x where x is not null and x <> me;
  if cardinality(others) < 2 then
    raise exception 'a group needs at least 2 other people';
  end if;
  if cardinality(others) > 9 then
    raise exception 'group is full';
  end if;
  foreach p in array others loop
    if not public.can_reach(p) then
      raise exception 'not reachable';
    end if;
  end loop;
  conv := gen_random_uuid();
  insert into public.conversations (id, is_group, owner_id) values (conv, true, me);
  insert into public.conversation_members (conversation_id, user_id) values (conv, me);
  insert into public.conversation_members (conversation_id, user_id) select conv, x from unnest(others) as x;
  return conv;
end $$;
grant execute on function public.create_group(uuid[]) to authenticated;

-- Any member can add people they can reach, up to 10 members in total.
create or replace function public.add_group_members(conv_id uuid, people uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  newcomers uuid[];
  p uuid;
  current_count int;
begin
  -- Lock the conversation so two members adding people at once can't overshoot the limit.
  perform 1 from public.conversations c where c.id = conv_id and c.is_group for update;
  if not found then
    raise exception 'not a group';
  end if;
  if not public.is_conversation_member(conv_id) then
    raise exception 'not authorized';
  end if;
  select coalesce(array_agg(distinct x), '{}') into newcomers from unnest(people) as x
    where x is not null
      and not exists (select 1 from public.conversation_members m where m.conversation_id = conv_id and m.user_id = x);
  if cardinality(newcomers) = 0 then
    return;
  end if;
  select count(*) into current_count from public.conversation_members m where m.conversation_id = conv_id;
  if current_count + cardinality(newcomers) > 10 then
    raise exception 'group is full';
  end if;
  foreach p in array newcomers loop
    if not public.can_reach(p) then
      raise exception 'not reachable';
    end if;
  end loop;
  insert into public.conversation_members (conversation_id, user_id) select conv_id, x from unnest(newcomers) as x;
end $$;
grant execute on function public.add_group_members(uuid, uuid[]) to authenticated;

-- Any member can rename the group; null or blank goes back to the members' names.
create or replace function public.rename_group(conv_id uuid, new_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v text := nullif(btrim(coalesce(new_name, '')), '');
begin
  if not exists (select 1 from public.conversations c where c.id = conv_id and c.is_group) then
    raise exception 'not a group';
  end if;
  if not public.is_conversation_member(conv_id) then
    raise exception 'not authorized';
  end if;
  if v is not null and char_length(v) > 100 then
    raise exception 'name too long';
  end if;
  update public.conversations c set name = v where c.id = conv_id;
end $$;
grant execute on function public.rename_group(uuid, text) to authenticated;

-- Leave a group. A leaving owner's role goes to a random remaining member; the last one out
-- deletes the group.
create or replace function public.leave_group(conv_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  conv public.conversations;
  next_owner uuid;
begin
  select * into conv from public.conversations c where c.id = conv_id and c.is_group for update;
  if not found then
    raise exception 'not a group';
  end if;
  delete from public.conversation_members m where m.conversation_id = conv_id and m.user_id = me;
  if not found then
    raise exception 'not a member';
  end if;
  if not exists (select 1 from public.conversation_members m where m.conversation_id = conv_id) then
    delete from public.conversations c where c.id = conv_id;
    return;
  end if;
  if conv.owner_id is null or conv.owner_id = me then
    select m.user_id into next_owner from public.conversation_members m
      where m.conversation_id = conv_id order by random() limit 1;
    update public.conversations c set owner_id = next_owner where c.id = conv_id;
  end if;
end $$;
grant execute on function public.leave_group(uuid) to authenticated;

-- Owner only: remove someone from the group.
create or replace function public.kick_group_member(conv_id uuid, target_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.conversations c where c.id = conv_id and c.is_group and c.owner_id = auth.uid()) then
    raise exception 'only the owner can remove people';
  end if;
  if target_id = auth.uid() then
    raise exception 'use leave_group to leave';
  end if;
  delete from public.conversation_members m where m.conversation_id = conv_id and m.user_id = target_id;
  if not found then
    raise exception 'not a member';
  end if;
end $$;
grant execute on function public.kick_group_member(uuid, uuid) to authenticated;

-- Owner only: make another member the owner.
create or replace function public.transfer_group_ownership(conv_id uuid, target_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.conversations c where c.id = conv_id and c.is_group and c.owner_id = auth.uid()) then
    raise exception 'only the owner can do that';
  end if;
  if not exists (select 1 from public.conversation_members m where m.conversation_id = conv_id and m.user_id = target_id) then
    raise exception 'not a member';
  end if;
  update public.conversations c set owner_id = target_id where c.id = conv_id;
end $$;
grant execute on function public.transfer_group_ownership(uuid, uuid) to authenticated;
