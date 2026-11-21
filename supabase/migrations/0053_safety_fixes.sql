-- 0053: fixes for 0052 (safety tools) after review.
--
--  1. A banned person can't erase their record with a still-valid token:
--     - delete_my_account() refuses ('this account has been banned').
--     - The account-deletion trigger refuses for a banned person when the one deleting is that
--       person (auth.uid() = the login being deleted). It runs as security definer, so
--       is_direct_client() would always be false there; auth.uid() identifies the caller instead.
--       The owner deleting a banned login from the Supabase dashboard or the admin API (no
--       auth.uid(), or the owner's) still works.
--     - "delete own messages" and "self leave server" need a live account.
--  2. Files returned for removal (site_ban with delete_messages, admin_delete_message) are only
--     those the message's author uploaded (storage.objects owner_id = author), so a message
--     pointing at someone else's public attachment can't get that file deleted.
--  3. site_ban's group hand-off picks a live member; only if there is none, any other member.
--     The redundant auth.refresh_tokens delete is gone (deleting auth.sessions cascades to them).
--  4. The site admin's storage policies cover only the buckets the admin tools remove files
--     from (attachments, server-icons, stickers).

-- ---------- 1. no self-erasure while banned ----------

-- Same as 0046, plus the ban check.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  if exists (select 1 from public.profiles p where p.id = me and p.banned_at is not null) then
    raise exception 'this account has been banned';
  end if;
  if exists (select 1 from public.servers s where s.owner_id = me) then
    raise exception 'transfer or delete your servers first';
  end if;
  delete from auth.users u where u.id = me;
end $$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Same as 0046, plus: a banned person can't delete their own login.
create or replace function public.tombstone_deleted_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid uuid := old.id;
  g uuid;
  uname text;
begin
  if auth.uid() = uid
     and exists (select 1 from public.profiles p where p.id = uid and p.banned_at is not null) then
    raise exception 'this account has been banned';
  end if;
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

-- Same as 0002 / 0005, plus a live account.
drop policy if exists "delete own messages" on public.messages;
create policy "delete own messages"
  on public.messages for delete to authenticated
  using (author_id = auth.uid() and public.is_live_account());

drop policy if exists "self leave server" on public.server_members;
create policy "self leave server" on public.server_members for delete to authenticated
  using (user_id = auth.uid() and public.is_live_account());

-- ---------- 2. only the author's own uploads are returned for removal ----------

-- The attachments-bucket paths of a message's image/file that its author uploaded. Internal.
create or replace function public.message_own_files(author uuid, image_url text, file_url text)
returns table (bucket text, path text) language sql stable security definer set search_path = public as $$
  select distinct 'attachments'::text, o.name::text
  from (values (public.attachment_path(image_url)), (public.attachment_path(file_url))) as u(p)
  join storage.objects o on o.bucket_id = 'attachments' and o.name = u.p and o.owner_id = author::text
  where u.p is not null;
$$;
revoke execute on function public.message_own_files(uuid, text, text) from public, anon, authenticated;

-- Same as 0052, but only the author's own uploads are returned.
create or replace function public.admin_delete_message(msg uuid)
returns table (bucket text, path text) language plpgsql security definer set search_path = public as $$
declare
  m public.messages;
  srv uuid;
begin
  if not public.is_site_admin() then
    raise exception 'not permitted';
  end if;
  select * into m from public.messages x where x.id = msg for update;
  if not found or not (exists (select 1 from public.reports r where r.message_id = msg) or public.can_read_message(msg)) then
    raise exception 'message not found';
  end if;
  delete from public.messages x where x.id = msg;
  if m.channel_id is not null and m.author_id <> auth.uid() then
    select c.server_id into srv from public.channels c where c.id = m.channel_id;
    insert into public.audit_log (server_id, action, actor_id, target_id)
      values (srv, 'message_delete', auth.uid(), m.author_id);
  end if;
  return query select f.bucket, f.path from public.message_own_files(m.author_id, m.image_url, m.file_url) f;
end $$;
revoke execute on function public.admin_delete_message(uuid) from public, anon;
grant execute on function public.admin_delete_message(uuid) to authenticated;

-- ---------- 3. site_ban ----------

-- Same as 0052, plus: group hand-off picks a live member first (any other member only if there is
-- none), only the author's own uploads are returned, and the refresh-token delete is left to the
-- auth.sessions cascade.
create or replace function public.site_ban(target uuid, delete_messages boolean default false, reason text default null)
returns table (bucket text, path text) language plpgsql security definer set search_path = public as $$
declare
  t public.profiles;
  g uuid;
  next_owner uuid;
begin
  if not public.is_site_admin() then
    raise exception 'not permitted';
  end if;
  if target = auth.uid() then
    raise exception 'you cannot ban yourself';
  end if;
  if exists (select 1 from public.site_admins a where a.user_id = target) then
    raise exception 'cannot ban a site admin';
  end if;
  -- Locks the profile: in-flight live-account checks (key share) finish first; later ones see the ban.
  select * into t from public.profiles p where p.id = target for update;
  if not found or t.deleted_at is not null then
    raise exception 'user not found';
  end if;
  if t.banned_at is not null then
    raise exception 'already banned';
  end if;
  if exists (select 1 from public.servers s where s.owner_id = target) then
    raise exception 'transfer or delete their servers first';
  end if;

  -- Group chats they own pass to a random live member; if none is live, to any other member.
  -- They stay a member.
  for g in select c.id from public.conversations c where c.is_group and c.owner_id = target for update loop
    next_owner := null;
    select m.user_id into next_owner from public.conversation_members m
      join public.profiles p on p.id = m.user_id
      where m.conversation_id = g and m.user_id <> target and p.deleted_at is null and p.banned_at is null
      order by random() limit 1;
    if next_owner is null then
      select m.user_id into next_owner from public.conversation_members m
        where m.conversation_id = g and m.user_id <> target
        order by random() limit 1;
    end if;
    if next_owner is not null then
      update public.conversations c set owner_id = next_owner where c.id = g;
    end if;
  end loop;

  insert into public.site_bans (user_id, banned_by, reason, deleted_messages)
    values (target, auth.uid(), public.clean_reason(site_ban.reason), coalesce(delete_messages, false));
  update public.profiles p set banned_at = now() where p.id = target;

  -- Supabase Auth: no sign-in, no token refresh; deleting the sessions also deletes their refresh
  -- tokens (foreign key cascade).
  update auth.users u set banned_until = now() + interval '100 years' where u.id = target;
  delete from auth.sessions s where s.user_id = target;

  if coalesce(delete_messages, false) then
    return query
      select distinct f.bucket, f.path
      from public.messages m
      cross join lateral public.message_own_files(m.author_id, m.image_url, m.file_url) f
      where m.author_id = target;
    delete from public.messages m where m.author_id = target;
  end if;
end $$;
revoke execute on function public.site_ban(uuid, boolean, text) from public, anon;
grant execute on function public.site_ban(uuid, boolean, text) to authenticated;

-- ---------- 4. storage ----------
-- Storage's remove() deletes with RETURNING, so the admin must also be able to SELECT the rows it
-- deletes; stickers have no public read policy, hence this select policy. Both are limited to the
-- buckets the admin tools remove files from (avatars are never removed by them).
drop policy if exists "site admin reads any object" on storage.objects;
create policy "site admin reads any object" on storage.objects for select to authenticated
  using (bucket_id in ('attachments', 'server-icons', 'stickers') and public.is_site_admin());
comment on policy "site admin reads any object" on storage.objects is
  'Needed by Storage remove(): it deletes with RETURNING, which needs SELECT. Site admin only, admin-tool buckets only.';
drop policy if exists "site admin deletes any object" on storage.objects;
create policy "site admin deletes any object" on storage.objects for delete to authenticated
  using (bucket_id in ('attachments', 'server-icons', 'stickers') and public.is_site_admin());
