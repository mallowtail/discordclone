-- Friends. One row per pair of people: `requester` asked `addressee`, and the row is 'pending'
-- until the addressee accepts. Declining, cancelling and unfriending all just delete the row.
-- Anyone can send a request to anyone (it's a small app; requests can simply be ignored).

create table public.friendships (
  requester uuid not null references public.profiles(id) on delete cascade,
  addressee uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (requester, addressee),
  check (requester <> addressee)
);
-- A→B and B→A are the same friendship: at most one row per unordered pair.
create unique index friendships_one_per_pair
  on public.friendships (least(requester, addressee), greatest(requester, addressee));
create index friendships_addressee on public.friendships (addressee);

alter table public.friendships enable row level security;
-- You can see the rows you're part of. Every write goes through the functions below, so there are
-- deliberately no insert/update/delete policies.
create policy "see own friendships" on public.friendships for select to authenticated
  using (auth.uid() = requester or auth.uid() = addressee);

-- Live updates for the Friends page and the request badge.
alter publication supabase_realtime add table public.friendships;

-- Send a request. If they already asked you, this accepts theirs instead of making a second row.
-- Returns 'requested', 'accepted', 'already_friends' or 'already_requested'.
create or replace function public.send_friend_request(target uuid)
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); existing public.friendships; lo uuid; hi uuid;
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  if target = me then
    raise exception 'cannot friend yourself';
  end if;
  if not exists (select 1 from public.profiles p where p.id = target) then
    raise exception 'user not found';
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
  insert into public.friendships (requester, addressee) values (me, target);
  return 'requested';
end $$;
grant execute on function public.send_friend_request(uuid) to authenticated;

-- Accept a request someone sent you.
create or replace function public.accept_friend_request(requester_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.friendships f set status = 'accepted', accepted_at = now()
    where f.requester = requester_id and f.addressee = auth.uid() and f.status = 'pending';
  if not found then
    raise exception 'no pending request';
  end if;
end $$;
grant execute on function public.accept_friend_request(uuid) to authenticated;

-- Decline a request, cancel one you sent, or unfriend: all remove the pair's row.
create or replace function public.remove_friend(other uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.friendships f
  where (f.requester = auth.uid() and f.addressee = $1) or (f.requester = $1 and f.addressee = auth.uid());
$$;
grant execute on function public.remove_friend(uuid) to authenticated;

-- People who are friends with both you and `other`. Needs security definer because you can't read
-- other people's friendship rows directly; it only ever reveals friends you already have.
create or replace function public.mutual_friends(other uuid)
returns setof public.profiles language sql security definer set search_path = public stable as $$
  with mine as (
    select case when f.requester = auth.uid() then f.addressee else f.requester end as id
    from public.friendships f
    where f.status = 'accepted' and (f.requester = auth.uid() or f.addressee = auth.uid())
  ), theirs as (
    select case when f.requester = $1 then f.addressee else f.requester end as id
    from public.friendships f
    where f.status = 'accepted' and (f.requester = $1 or f.addressee = $1)
  )
  select p.* from public.profiles p
  where p.id in (select id from mine intersect select id from theirs)
  order by lower(p.display_name);
$$;
grant execute on function public.mutual_friends(uuid) to authenticated;
