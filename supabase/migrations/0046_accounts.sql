-- Accounts: delete my account ("Deleted User" tombstones), server ownership transfer, delete server,
-- 1–20 character usernames.
--
--   1. profiles.deleted_at; the profile no longer disappears with the login (its foreign key to
--      auth.users is dropped), so messages and reactions keep pointing at it.
--   2. bans.banned_by → on delete set null (it blocked deleting anyone who had ever banned someone).
--   3. Usernames: 1–20 characters; new ones can't start with "deleted_" (the tombstones' names).
--      deleted_at can't be set or cleared by the app's users, and a tombstone can't be edited.
--   4. A trigger on auth.users: deleting a login in any way (the app's button, the Supabase dashboard,
--      the admin API, a soft delete) refuses while the person owns a server, and otherwise leaves
--      their group chats, removes their personal rows and turns the profile into "Deleted User".
--      delete_my_account() is the app's button.
--   5. Tombstones can't be messaged, called, friended or added to groups.
--   6. delete_server(srv) and transfer_server_ownership(srv, new_owner), owner only. A transfer is
--      logged as `ownership_transfer`.

-- ---------- 1. tombstone column; profile outlives the login ----------
alter table public.profiles add column deleted_at timestamptz;
alter table public.profiles drop constraint profiles_id_fkey;

-- ---------- 2. bans.banned_by ----------
alter table public.bans drop constraint bans_banned_by_fkey;
alter table public.bans add constraint bans_banned_by_fkey
  foreign key (banned_by) references public.profiles(id) on delete set null;

-- ---------- 3. usernames, protected tombstones ----------
alter table public.profiles drop constraint profiles_username_format;
alter table public.profiles add constraint profiles_username_format check (username ~ '^[A-Za-z0-9_]{1,20}$');
alter table public.profiles add constraint profiles_username_reserved check (
  deleted_at is not null or username !~* '^deleted_'
);

-- Same as 0032, plus: the app's users can't set or clear deleted_at, and can't edit a tombstone
-- (someone still holding a deleted account's sign-in token for up to an hour).
create or replace function public.clean_profile()
returns trigger language plpgsql as $$
begin
  new.display_name := btrim(public.strip_invisible(new.display_name));
  new.bio := public.strip_invisible(new.bio);
  new.status := public.strip_invisible(new.status);
  if tg_op = 'INSERT' and public.is_direct_client() then
    new.deleted_at := null;
  end if;
  if tg_op = 'UPDATE' and public.is_direct_client() then
    if old.deleted_at is not null then
      raise exception 'this account was deleted';
    end if;
    new.id := old.id;
    new.created_at := old.created_at; -- "Member since" can't be faked
    new.deleted_at := old.deleted_at;
  end if;
  return new;
end $$;

-- ---------- 4. account deletion ----------

-- The body of leave_group (0031) for a given person, so the account-deletion trigger (where
-- auth.uid() is whoever is deleting, or nobody) can reuse it. Internal: not callable by the app.
create or replace function public.leave_group_as(conv_id uuid, me uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
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
revoke execute on function public.leave_group_as(uuid, uuid) from public, anon, authenticated;

create or replace function public.leave_group(conv_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.leave_group_as(conv_id, auth.uid());
end $$;
grant execute on function public.leave_group(uuid) to authenticated;

-- Runs before a login is deleted (or soft-deleted). Acts on old.id, never auth.uid().
-- Kept: messages, reactions, poll votes, 1:1 DM memberships (the other person keeps the DM),
-- audit log entries, calls, stickers they uploaded.
create or replace function public.tombstone_deleted_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid uuid := old.id;
  g uuid;
  uname text;
begin
  -- Lock the profile first: a concurrent transfer_server_ownership to this person waits, then sees
  -- the tombstone and refuses.
  perform 1 from public.profiles p where p.id = uid and p.deleted_at is null for update;
  if found then
    if exists (select 1 from public.servers s where s.owner_id = uid) then
      raise exception 'transfer or delete your servers first';
    end if;

    for g in
      select m.conversation_id from public.conversation_members m
      join public.conversations c on c.id = m.conversation_id and c.is_group
      where m.user_id = uid
    loop
      perform public.leave_group_as(g, uid);
    end loop;

    delete from public.member_roles where user_id = uid;
    delete from public.server_members where user_id = uid;
    delete from public.bans where user_id = uid;
    delete from public.friendships where requester = uid or addressee = uid;
    delete from public.user_blocks where blocker = uid or blocked = uid;
    delete from public.favorite_gifs where user_id = uid;
    delete from public.channel_reads where user_id = uid;

    uname := 'deleted_' || substr(replace(uid::text, '-', ''), 1, 8);
    if exists (select 1 from public.profiles p where p.username = uname) then
      uname := 'deleted_' || substr(replace(uid::text, '-', ''), 1, 12);
    end if;
    update public.profiles p set
      display_name = 'Deleted User',
      username = uname,
      avatar_url = null,
      bio = null,
      status = null,
      recent_emojis = '{}',
      trusted_domains = '{}',
      dm_policy = 'none',
      fr_everyone = false,
      fr_friends_of_friends = false,
      fr_server_members = false,
      deleted_at = now()
    where p.id = uid;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;
revoke execute on function public.tombstone_deleted_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_deleted on auth.users;
create trigger on_auth_user_deleted before delete on auth.users
  for each row execute function public.tombstone_deleted_user();
drop trigger if exists on_auth_user_soft_deleted on auth.users;
create trigger on_auth_user_soft_deleted before update of deleted_at on auth.users
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function public.tombstone_deleted_user();

-- The app's "Delete account" button. Deleting the login fires the trigger above.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  if exists (select 1 from public.servers s where s.owner_id = me) then
    raise exception 'transfer or delete your servers first';
  end if;
  delete from auth.users u where u.id = me;
end $$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------- 5. tombstones are unreachable ----------

-- Same as 0040, but a tombstone counts as dm_policy 'none' whatever its row says.
create or replace function public.can_reach(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and $1 is not null and $1 <> auth.uid()
    and not public.is_blocked_pair(auth.uid(), $1)
    and case (select case when p.deleted_at is not null then 'none' else p.dm_policy end
              from public.profiles p where p.id = $1)
      when 'none' then false
      when 'friends' then public.are_friends(auth.uid(), $1)
      when 'reachable' then public.are_friends(auth.uid(), $1) or public.share_server(auth.uid(), $1) or public.share_conversation(auth.uid(), $1)
      else false
    end;
$$;
grant execute on function public.can_reach(uuid) to authenticated;

-- Same as 0040, plus: a tombstone is "user not found".
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
  if not found or t.deleted_at is not null then
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
grant execute on function public.send_friend_request(uuid) to authenticated;

-- ---------- 6. server ownership transfer, delete server ----------

-- Same as 0005, but security-definer functions (transfer_server_ownership) may change the owner;
-- the app's users still can't directly.
create or replace function public.protect_server_owner()
returns trigger language plpgsql as $$
begin
  if new.owner_id is distinct from old.owner_id and public.is_direct_client() then
    raise exception 'owner_id cannot be changed';
  end if;
  return new;
end $$;

alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check check (
  action in ('kick', 'ban', 'unban', 'timeout', 'timeout_removed', 'sticker_create', 'sticker_delete',
             'ownership_transfer')
);

create or replace function public.transfer_server_ownership(srv uuid, new_owner uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  perform 1 from public.servers s where s.id = srv and s.owner_id = me for update;
  if me is null or not found then
    raise exception 'only the owner can do that';
  end if;
  if new_owner is null or new_owner = me then
    raise exception 'you already own this server';
  end if;
  -- Locks the new owner's profile so they can't finish deleting their account meanwhile.
  perform 1 from public.profiles p where p.id = new_owner and p.deleted_at is null for update;
  if not found
     or not exists (select 1 from public.server_members m where m.server_id = srv and m.user_id = new_owner) then
    raise exception 'not a member';
  end if;
  update public.servers s set owner_id = new_owner where s.id = srv;
  insert into public.audit_log (server_id, action, actor_id, target_id)
    values (srv, 'ownership_transfer', me, new_owner);
end $$;
revoke execute on function public.transfer_server_ownership(uuid, uuid) from public, anon;
grant execute on function public.transfer_server_ownership(uuid, uuid) to authenticated;

-- Channels, categories, messages, roles, members, bans, invites, stickers and the audit log go with
-- it (foreign keys cascade). The app removes the server's storage files first.
create or replace function public.delete_server(srv uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.servers s where s.id = srv and s.owner_id = auth.uid() for update;
  if auth.uid() is null or not found then
    raise exception 'only the owner can delete the server';
  end if;
  delete from public.servers s where s.id = srv;
end $$;
revoke execute on function public.delete_server(uuid) from public, anon;
grant execute on function public.delete_server(uuid) to authenticated;
