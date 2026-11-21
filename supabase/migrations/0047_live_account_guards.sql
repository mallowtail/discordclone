-- Live-account guards. After an account is deleted (0046) its sign-in token stays valid for up to
-- an hour. Everything that creates something owned by the caller, or joins them to something, now
-- refuses unless the caller is a live account: a profile that isn't a tombstone and a login that
-- still exists. Error: 'this account was deleted' ('finish setting up your account first' when the
-- login has no profile yet).
--
-- Guarded: create_server (+ direct server inserts), join_via_invite (+ self-join of public servers),
-- sending and editing messages (this covers create_poll and forwards), reactions, vote_poll,
-- end_poll, toggle_pin, send_friend_request, block_user, get_or_create_dm, create_group,
-- add_group_members, start_call, push_recent_emoji, favourite GIFs, channel reads. A new profile
-- needs a login row for its id.
--
-- Not guarded, because a tombstone has no server roles, owns no server and is in no group, so
-- these refuse anyway: invites, roles, moderation, stickers, group rename/kick/transfer.
-- Removals (leave, unblock, unfriend, end_call) are harmless.
--
-- Concurrency: the check takes a key-share lock on the caller's profile row. Account deletion
-- locks that row for update, so a create_server/join racing a deletion either waits and then sees
-- the tombstone, or finishes first, and then deletion sees the new server and refuses.

create or replace function public.is_live_account()
returns boolean language plpgsql volatile security definer set search_path = public as $$
begin
  perform 1 from public.profiles p where p.id = auth.uid() and p.deleted_at is null for key share;
  return found and exists (select 1 from auth.users u where u.id = auth.uid());
end $$;
revoke execute on function public.is_live_account() from public, anon;
grant execute on function public.is_live_account() to authenticated;

create or replace function public.require_live_account()
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_live_account() then
    if auth.uid() is not null
       and exists (select 1 from auth.users u where u.id = auth.uid())
       and not exists (select 1 from public.profiles p where p.id = auth.uid()) then
      raise exception 'finish setting up your account first';
    end if;
    raise exception 'this account was deleted';
  end if;
end $$;
revoke execute on function public.require_live_account() from public, anon;
grant execute on function public.require_live_account() to authenticated;

-- A login exists for the caller (a profile can only be made for a real login).
create or replace function public.has_login()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from auth.users u where u.id = auth.uid());
$$;
revoke execute on function public.has_login() from public, anon;
grant execute on function public.has_login() to authenticated;

-- ---------- policies (restrictive: added on top of the existing ones) ----------
create policy "live accounts only" on public.profiles as restrictive for insert to authenticated
  with check (public.has_login());
create policy "live accounts only" on public.servers as restrictive for insert to authenticated
  with check (public.is_live_account());
create policy "live accounts only" on public.server_members as restrictive for insert to authenticated
  with check (public.is_live_account());
create policy "live accounts only" on public.reactions as restrictive for insert to authenticated
  with check (public.is_live_account());
create policy "live accounts only" on public.favorite_gifs as restrictive for insert to authenticated
  with check (public.is_live_account());
create policy "live accounts only" on public.channel_reads as restrictive for insert to authenticated
  with check (public.is_live_account());

-- ---------- RPCs ----------

-- add_group_members: newest definition, plus the live-account check.
CREATE OR REPLACE FUNCTION public.add_group_members(conv_id uuid, people uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me uuid := auth.uid();
  newcomers uuid[];
  p uuid;
  current_count int;
begin
  perform public.require_live_account();
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
end $function$;

-- block_user: newest definition, plus the live-account check.
CREATE OR REPLACE FUNCTION public.block_user(target uuid, block_kind text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid();
begin
  perform public.require_live_account();
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
end $function$;

-- create_group: newest definition, plus the live-account check.
CREATE OR REPLACE FUNCTION public.create_group(people uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me uuid := auth.uid();
  others uuid[];
  p uuid;
  conv uuid;
begin
  perform public.require_live_account();
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
end $function$;

-- create_server: newest definition, plus the live-account check.
CREATE OR REPLACE FUNCTION public.create_server(server_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare srv uuid; cat uuid; c text;
begin
  perform public.require_live_account();
  c := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  insert into public.servers (name, owner_id, invite_code)
    values (server_name, auth.uid(), c)
    returning id into srv;
  insert into public.server_members (server_id, user_id) values (srv, auth.uid());
  insert into public.categories (server_id, name, position) values (srv, 'Text Channels', 0) returning id into cat;
  insert into public.channels (name, position, server_id, category_id) values ('general', 0, srv, cat);
  insert into public.invites (code, server_id, created_by) values (c, srv, auth.uid());
  return srv;
end $function$;

-- end_poll: newest definition, plus the live-account check.
CREATE OR REPLACE FUNCTION public.end_poll(msg uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.require_live_account();
  update public.polls p set ends_at = least(p.ends_at, now())
  where p.message_id = msg
    and exists (select 1 from public.messages m where m.id = msg and m.author_id = auth.uid());
  if not found then
    raise exception 'only the poll''s author can end it';
  end if;
end $function$;

-- get_or_create_dm: newest definition, plus the live-account check.
CREATE OR REPLACE FUNCTION public.get_or_create_dm(other uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me   uuid := auth.uid();
  lo   uuid;
  hi   uuid;
  conv uuid;
begin
  perform public.require_live_account();
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
$function$;

-- join_via_invite: newest definition, plus the live-account check.
CREATE OR REPLACE FUNCTION public.join_via_invite(code text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare inv public.invites; joined integer;
begin
  perform public.require_live_account();
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
end $function$;

-- send_friend_request: newest definition, plus the live-account check.
CREATE OR REPLACE FUNCTION public.send_friend_request(target uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); existing public.friendships; lo uuid; hi uuid; t public.profiles;
begin
  perform public.require_live_account();
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
end $function$;

-- start_call: newest definition, plus the live-account check.
CREATE OR REPLACE FUNCTION public.start_call(conv uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare existing uuid; c uuid;
begin
  perform public.require_live_account();
  if not public.is_conversation_member(conv) then
    raise exception 'not a member';
  end if;
  if not public.dm_send_allowed(conv) then
    raise exception 'cannot call this person';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('call:' || conv::text, 0));
  update public.calls x set ended_at = now()
    where x.conversation_id = conv and x.ended_at is null and x.started_at < now() - interval '12 hours';
  select x.id into existing from public.calls x where x.conversation_id = conv and x.ended_at is null limit 1;
  if existing is not null then
    return existing;
  end if;
  insert into public.calls (conversation_id, started_by) values (conv, auth.uid()) returning id into c;
  return c;
end $function$;

-- toggle_pin: newest definition, plus the live-account check.
CREATE OR REPLACE FUNCTION public.toggle_pin(msg uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.require_live_account();
  if not public.can_read_message(msg) then
    raise exception 'not allowed';
  end if;
  update public.messages
    set pinned = not pinned,
        pinned_at = case when not pinned then now() else null end
    where id = msg;
end; $function$;

-- vote_poll: newest definition, plus the live-account check.
CREATE OR REPLACE FUNCTION public.vote_poll(msg uuid, option_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  p public.polls;
  picked uuid[];
begin
  perform public.require_live_account();
  if not public.can_read_message(msg) then
    raise exception 'not authorized';
  end if;
  if public.is_timed_out_message(msg) then
    raise exception 'you are timed out';
  end if;
  select * into p from public.polls where message_id = msg;
  if not found then
    raise exception 'not a poll';
  end if;
  if p.ends_at <= now() then
    raise exception 'poll has ended';
  end if;
  select coalesce(array_agg(distinct x), '{}') into picked from unnest(option_ids) as x where x is not null;
  if exists (
    select 1 from unnest(picked) as x
    where not exists (select 1 from public.poll_options o where o.id = x and o.message_id = msg)
  ) then
    raise exception 'invalid poll answer';
  end if;
  if not p.allow_multiple and cardinality(picked) > 1 then
    raise exception 'this poll allows one answer';
  end if;
  delete from public.poll_votes v where v.message_id = msg and v.user_id = auth.uid();
  insert into public.poll_votes (message_id, option_id, user_id) select msg, x, auth.uid() from unnest(picked) as x;
  update public.polls set updated_at = now() where message_id = msg;
end $function$;

-- ---------- message guards (still invoker functions; the check itself is security definer) ----------
-- guard_message_insert: newest definition (0044), plus the live-account check for the app's users.
CREATE OR REPLACE FUNCTION public.guard_message_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  src public.messages;
  src_id uuid;
  st public.stickers;
  st_id uuid;
begin
  if not public.is_direct_client() then
    return new;
  end if;
  perform public.require_live_account();

  -- 7. spam limit
  if public.recent_message_count() >= 5 then
    raise exception 'slow down: too many messages' using hint = 'rate_limited';
  end if;

  new.content := public.strip_message_controls(new.content);
  -- Server-controlled fields: a new message is never pre-pinned, edited, or backdated.
  new.created_at := now();
  new.updated_at := null;
  new.pinned := false;
  new.pinned_at := null;

  -- 2. forwards: the client names the message; the snapshot is rebuilt from it here.
  if new.forward_snapshot is not null then
    begin
      src_id := (new.forward_snapshot->>'message_id')::uuid;
    exception when invalid_text_representation then
      src_id := null;
    end;
    if src_id is null or not public.can_read_message(src_id) then
      raise exception 'cannot forward that message';
    end if;
    select * into src from public.messages m where m.id = src_id;
    new.forward_snapshot := jsonb_build_object(
      'message_id', src.id,
      'author_id', src.author_id,
      'content', coalesce(src.content, ''),
      'image_url', src.image_url,
      'file_url', src.file_url,
      'file_name', src.file_name,
      'gif', src.gif,
      'sticker', src.sticker,
      'source', case
        when src.channel_id is not null then coalesce('#' || (select c.name from public.channels c where c.id = src.channel_id), 'a channel')
        else 'a direct message'
      end
    );
  end if;

  -- Stickers: the client names the sticker; you must be in its server; the snapshot is rebuilt
  -- from the sticker row here; a sticker message has nothing else in it.
  if new.sticker is not null then
    begin
      st_id := (new.sticker->>'id')::uuid;
    exception when invalid_text_representation then
      st_id := null;
    end;
    if st_id is null then
      raise exception 'cannot use that sticker';
    end if;
    st := public.sticker_for_send(st_id);
    if st.id is null then
      raise exception 'cannot use that sticker';
    end if;
    if new.content <> '' or new.image_url is not null or new.file_url is not null
       or new.gif is not null or new.forward_snapshot is not null or new.poll then
      raise exception 'a sticker is sent on its own';
    end if;
    new.sticker := jsonb_build_object(
      'id', st.id,
      'name', st.name,
      'url', 'https://dpsikhsxdwigeuyonfch.supabase.co/storage/v1/object/public/stickers/' || st.path,
      'width', st.width,
      'height', st.height
    );
  end if;
  return new;
end $function$;

-- guard_message_update: newest definition (0044), plus the live-account check for the app's users.
CREATE OR REPLACE FUNCTION public.guard_message_update()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if not public.is_direct_client() then
    return new;
  end if;
  perform public.require_live_account();
  if new.id is distinct from old.id
     or new.author_id is distinct from old.author_id
     or new.channel_id is distinct from old.channel_id
     or new.conversation_id is distinct from old.conversation_id
     or new.created_at is distinct from old.created_at
     or new.image_url is distinct from old.image_url
     or new.file_url is distinct from old.file_url
     or new.file_name is distinct from old.file_name
     or new.reply_to_id is distinct from old.reply_to_id
     or new.mention_author is distinct from old.mention_author
     or new.pinned is distinct from old.pinned
     or new.pinned_at is distinct from old.pinned_at
     or new.forward_snapshot is distinct from old.forward_snapshot
     or new.poll is distinct from old.poll
     or new.gif is distinct from old.gif
     or new.sticker is distinct from old.sticker then
    raise exception 'only the message text can be edited';
  end if;
  if old.poll and new.content is distinct from old.content then
    raise exception 'polls can''t be edited';
  end if;
  -- A sticker is sent on its own, so it can't gain text by editing either.
  if old.sticker is not null and new.content is distinct from old.content then
    raise exception 'a sticker is sent on its own';
  end if;
  new.content := public.strip_message_controls(new.content);
  new.updated_at := case when new.content is distinct from old.content then now() else old.updated_at end;
  return new;
end $function$;

-- push_recent_emoji: newest definition (0015), plus the live-account check.
create or replace function public.push_recent_emoji(e text)
returns void language sql security definer set search_path = public as $$
  select public.require_live_account();
  update public.profiles
     set recent_emojis =
       (array[e] || array_remove(recent_emojis, e))[1:12]
   where id = auth.uid();
$$;

-- transfer_server_ownership: as in 0046, but a null new_owner is 'not a member'.
create or replace function public.transfer_server_ownership(srv uuid, new_owner uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  perform 1 from public.servers s where s.id = srv and s.owner_id = me for update;
  if me is null or not found then
    raise exception 'only the owner can do that';
  end if;
  if new_owner = me then
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
