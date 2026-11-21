-- 0052: safety tools — reports, moderator message delete, the site admin, site-wide bans.
--
--  1. profiles.banned_at: set/cleared only by site_ban/site_unban (clean_profile keeps the app's
--     users from touching it, like deleted_at). The app shows a banned person like a deleted
--     account; nothing about them is erased.
--  2. Live-account guards (0047) now also refuse banned people ('this account has been banned').
--     A banned person's roles grant nothing (has_server_permission / my_permissions), they can't be
--     reached, friended, or given a server. create_invite, accept_friend_request and rename_group
--     (unguarded until now) need a live account.
--  3. site_admins: one row per site admin, written only by migrations / the Management API. Seeded
--     with the owner's account. is_site_admin().
--  4. view_reports role permission (owner always; roles with manage_server get it now).
--  5. reports + create_report (snapshot, rate limit, one open report per target) + handle_report.
--     Moderators (view_reports) see message reports from their own server's channels, except
--     reports about someone who holds view_reports there (admin_only, also checked live). The site
--     admin sees everything.
--  6. delete_message_as_mod: manage_messages holders delete anyone's channel messages in that
--     server; logged as `message_delete` (target = the author).
--  7. Site bans: site_bans, site_ban, site_unban. Ban: refuses while they own a server; groups they
--     own go to a random member; Supabase Auth refuses their login and token refresh
--     (auth.users.banned_until) and their sessions are deleted; optionally all their messages go.
--  8. Admin tools: admin_delete_message, admin_delete_server, admin_transfer_server,
--     admin_user_servers, admin_server_members, admin_list_servers.
--  9. Storage: the site admin may read and delete any object (files are removed through the
--     Storage API; SQL can't delete storage rows). Functions that delete messages or servers return
--     the (bucket, path) of the files the app should then remove.

-- ---------- 1. profiles.banned_at ----------
alter table public.profiles add column banned_at timestamptz;

-- Same as 0046, plus banned_at: the app's users can't set or clear it, and a banned person can't
-- edit their profile.
create or replace function public.clean_profile()
returns trigger language plpgsql as $$
begin
  new.display_name := btrim(public.strip_invisible(new.display_name));
  new.bio := public.strip_invisible(new.bio);
  new.status := public.strip_invisible(new.status);
  if tg_op = 'INSERT' and public.is_direct_client() then
    new.deleted_at := null;
    new.banned_at := null;
  end if;
  if tg_op = 'UPDATE' and public.is_direct_client() then
    if old.deleted_at is not null then
      raise exception 'this account was deleted';
    end if;
    if old.banned_at is not null then
      raise exception 'this account has been banned';
    end if;
    new.id := old.id;
    new.created_at := old.created_at; -- "Member since" can't be faked
    new.deleted_at := old.deleted_at;
    new.banned_at := old.banned_at;
  end if;
  return new;
end $$;

-- ---------- 2. live-account guards ----------

-- Same as 0047, plus: not banned. site_ban locks the profile row for update, so a write racing a
-- ban either finishes first or waits and then sees the ban.
create or replace function public.is_live_account()
returns boolean language plpgsql volatile security definer set search_path = public as $$
begin
  perform 1 from public.profiles p
    where p.id = auth.uid() and p.deleted_at is null and p.banned_at is null for key share;
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
    if exists (select 1 from public.profiles p where p.id = auth.uid() and p.deleted_at is null and p.banned_at is not null) then
      raise exception 'this account has been banned';
    end if;
    raise exception 'this account was deleted';
  end if;
end $$;
revoke execute on function public.require_live_account() from public, anon;
grant execute on function public.require_live_account() to authenticated;

-- True when the caller is banned (internal helper for the permission functions below).
create or replace function public.caller_is_banned()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.banned_at is not null);
$$;
revoke execute on function public.caller_is_banned() from public, anon, authenticated;

-- Same as 0012, but a banned caller has no permissions (they keep their roles as a record).
create or replace function public.has_server_permission(srv uuid, perm text)
returns boolean language sql security definer set search_path = public as $$
  select not public.caller_is_banned() and (
    exists (select 1 from public.servers s where s.id = srv and s.owner_id = auth.uid())
    or exists (
      select 1 from public.member_roles mr
      join public.roles r on r.id = mr.role_id
      where mr.server_id = srv and mr.user_id = auth.uid()
        and perm = any(r.permissions)
    )
  );
$$;
grant execute on function public.has_server_permission(uuid, text) to authenticated;

-- Same as 0046, plus: a banned person counts as dm_policy 'none'.
create or replace function public.can_reach(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and $1 is not null and $1 <> auth.uid()
    and not public.is_blocked_pair(auth.uid(), $1)
    and case (select case when p.deleted_at is not null or p.banned_at is not null then 'none' else p.dm_policy end
              from public.profiles p where p.id = $1)
      when 'none' then false
      when 'friends' then public.are_friends(auth.uid(), $1)
      when 'reachable' then public.are_friends(auth.uid(), $1) or public.share_server(auth.uid(), $1) or public.share_conversation(auth.uid(), $1)
      else false
    end;
$$;
grant execute on function public.can_reach(uuid) to authenticated;

-- Same as 0046, plus: a banned person is "user not found", and the caller must be live.
create or replace function public.send_friend_request(target uuid)
returns text language plpgsql security definer set search_path = public as $$
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
  if not found or t.deleted_at is not null or t.banned_at is not null then
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

-- Same as 0047, plus: the new owner can't be banned.
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
  -- Locks the new owner's profile so they can't finish deleting their account (or be banned)
  -- meanwhile.
  perform 1 from public.profiles p
    where p.id = new_owner and p.deleted_at is null and p.banned_at is null for update;
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

-- Live definitions, plus the live-account check.
create or replace function public.create_invite(srv uuid, expires_in integer default 604800, use_limit integer default null)
returns text language plpgsql security definer set search_path = public as $$
declare c text;
begin
  perform public.require_live_account();
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

create or replace function public.accept_friend_request(requester_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_live_account();
  update public.friendships f set status = 'accepted', accepted_at = now()
    where f.requester = requester_id and f.addressee = auth.uid() and f.status = 'pending';
  if not found then
    raise exception 'no pending request';
  end if;
end $$;

create or replace function public.rename_group(conv_id uuid, new_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v text := nullif(btrim(coalesce(new_name, '')), '');
begin
  perform public.require_live_account();
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

-- ---------- 3. site admins ----------
create table public.site_admins (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.site_admins enable row level security;
revoke all on public.site_admins from anon, authenticated;
grant select on public.site_admins to authenticated;
create policy "site admin reads own row" on public.site_admins for select to authenticated
  using (user_id = auth.uid());

create or replace function public.is_site_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.site_admins a
    join public.profiles p on p.id = a.user_id
    where a.user_id = auth.uid() and p.deleted_at is null and p.banned_at is null
  );
$$;
revoke execute on function public.is_site_admin() from public, anon;
grant execute on function public.is_site_admin() to authenticated;

-- The owner's account: the one login with a Gmail address. Skipped on a database without one
-- (e.g. local); refuses if there is more than one.
do $seed$
declare n int;
begin
  select count(*) into n from auth.users u where lower(u.email) like '%@gmail.com';
  if n > 1 then
    raise exception 'more than one gmail account; seed site_admins by hand';
  end if;
  insert into public.site_admins (user_id)
    select u.id from auth.users u join public.profiles p on p.id = u.id
    where lower(u.email) like '%@gmail.com'
    on conflict do nothing;
end $seed$;

-- ---------- 4. view_reports permission ----------
alter table public.roles drop constraint if exists roles_valid_permissions;
alter table public.roles add constraint roles_valid_permissions check (
  permissions <@ array['manage_channels','manage_server','manage_roles',
    'kick_members','ban_members','timeout_members','manage_messages','manage_stickers',
    'manage_server_icon','view_reports']::text[]
);

-- Same as 0050, plus view_reports for the owner, and nothing for a banned caller.
create or replace function public.my_permissions(srv uuid)
returns text[] language sql security definer set search_path = public stable as $$
  select case
    when public.caller_is_banned() then array[]::text[]
    when exists (select 1 from public.servers s where s.id = srv and s.owner_id = auth.uid())
      then array['manage_channels','manage_server','manage_roles',
                 'kick_members','ban_members','timeout_members','manage_messages','manage_stickers',
                 'manage_server_icon','view_reports']::text[]
    else coalesce((
      select array_agg(distinct p)
      from public.member_roles mr
      join public.roles r on r.id = mr.role_id
      cross join lateral unnest(r.permissions) as p
      where mr.server_id = srv and mr.user_id = auth.uid()
    ), array[]::text[])
  end;
$$;

update public.roles set permissions = permissions || array['view_reports']
  where 'manage_server' = any(permissions) and not 'view_reports' = any(permissions);

-- Whether a given person (not the caller) holds a permission in a server. Internal.
create or replace function public.user_has_server_permission(srv uuid, uid uuid, perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select uid is not null and (
    exists (select 1 from public.servers s where s.id = srv and s.owner_id = uid)
    or exists (
      select 1 from public.member_roles mr
      join public.roles r on r.id = mr.role_id
      where mr.server_id = srv and mr.user_id = uid and perm = any(r.permissions)
    )
  );
$$;
revoke execute on function public.user_has_server_permission(uuid, uuid, text) from public, anon, authenticated;

-- ---------- 5. reports ----------
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('message', 'user', 'server')),
  message_id uuid, -- no foreign key: the report outlives the message
  target_user_id uuid references public.profiles(id) on delete set null,
  server_id uuid references public.servers(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  snapshot jsonb not null,
  reason text not null check (reason in ('spam', 'harassment', 'inappropriate', 'hate_speech', 'other')),
  note text check (note is null or char_length(note) <= 500),
  admin_only boolean not null default false,
  status text not null default 'open' check (status in ('open', 'handled')),
  handled_by uuid references public.profiles(id) on delete set null,
  handled_note text check (handled_note is null or char_length(handled_note) <= 500),
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint reports_message_has_id check (kind <> 'message' or message_id is not null)
);
create index reports_server_status on public.reports (server_id, status, created_at desc);
create index reports_status_time on public.reports (status, created_at desc);
create index reports_reporter_time on public.reports (reporter_id, created_at desc);
-- One open report per reporter per target.
create unique index reports_one_open_per_target on public.reports (
  reporter_id, kind, (case kind when 'message' then message_id when 'user' then target_user_id else server_id end)
) where status = 'open';

alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;
grant select on public.reports to authenticated;

-- Who may see (and handle) a report: the site admin; or, for a message report in a server, a
-- view_reports holder there, unless the reported person is the caller or holds view_reports there
-- themselves (now, or when the report was made: admin_only).
create or replace function public.can_view_report(srv uuid, rkind text, admin_only boolean, target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_site_admin()
    or (rkind = 'message' and not admin_only and srv is not null and target is not null
        and target <> auth.uid()
        and public.has_server_permission(srv, 'view_reports')
        and not public.user_has_server_permission(srv, target, 'view_reports'));
$$;
revoke execute on function public.can_view_report(uuid, text, boolean, uuid) from public, anon;
grant execute on function public.can_view_report(uuid, text, boolean, uuid) to authenticated;

create policy "admins and moderators read reports" on public.reports for select to authenticated
  using (public.can_view_report(server_id, kind, admin_only, target_user_id));

alter publication supabase_realtime add table public.reports;

-- report_kind: 'message' | 'user' | 'server'; target: the message, user or server id.
-- reason: 'spam' | 'harassment' | 'inappropriate' | 'hate_speech' | 'other'; note ≤ 500.
-- Errors: 'invalid report', 'note too long', 'message not found', 'user not found',
-- 'server not found', 'cannot report yourself', 'cannot report your own server',
-- 'slow down: too many reports' (hint rate_limited; 10 per 10 minutes), 'already reported'.
create or replace function public.create_report(report_kind text, target uuid, report_reason text, report_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  n text := nullif(btrim(public.strip_invisible(coalesce(report_note, ''))), '');
  m public.messages;
  ch public.channels;
  srv public.servers;
  conv public.conversations;
  author public.profiles;
  t public.profiles;
  snap jsonb;
  r_server uuid;
  r_conv uuid;
  r_target uuid;
  r_admin_only boolean := false;
  new_id uuid;
begin
  perform public.require_live_account();
  if report_kind is null or report_kind not in ('message', 'user', 'server')
     or report_reason is null or report_reason not in ('spam', 'harassment', 'inappropriate', 'hate_speech', 'other')
     or target is null then
    raise exception 'invalid report';
  end if;
  if n is not null and char_length(n) > 500 then
    raise exception 'note too long';
  end if;

  -- Rate limit (serialized per reporter).
  perform pg_advisory_xact_lock(hashtextextended('report:' || me::text, 0));
  if (select count(*) from public.reports x where x.reporter_id = me and x.created_at > now() - interval '10 minutes') >= 10 then
    raise exception 'slow down: too many reports' using hint = 'rate_limited';
  end if;

  if report_kind = 'message' then
    select * into m from public.messages x where x.id = target;
    if not found or not public.can_read_message(target) then
      raise exception 'message not found';
    end if;
    if m.author_id = me then
      raise exception 'cannot report yourself';
    end if;
    select * into author from public.profiles p where p.id = m.author_id;
    if m.channel_id is not null then
      select * into ch from public.channels c where c.id = m.channel_id;
      select * into srv from public.servers s where s.id = ch.server_id;
      r_server := ch.server_id;
      r_admin_only := public.user_has_server_permission(r_server, m.author_id, 'view_reports');
    else
      select * into conv from public.conversations c where c.id = m.conversation_id;
      r_conv := m.conversation_id;
    end if;
    r_target := m.author_id;
    snap := jsonb_build_object(
      'message_id', m.id,
      'author_id', m.author_id,
      'author_username', author.username,
      'author_display_name', author.display_name,
      'author_avatar_url', author.avatar_url,
      'content', m.content,
      'image_url', m.image_url,
      'file_url', m.file_url,
      'file_name', m.file_name,
      'gif', m.gif,
      'sticker', m.sticker,
      'forward_snapshot', m.forward_snapshot,
      'poll_options', case when m.poll then
        (select jsonb_agg(o.label order by o.position) from public.poll_options o where o.message_id = m.id) end,
      'created_at', m.created_at,
      'edited_at', m.updated_at,
      'channel_id', m.channel_id,
      'channel_name', ch.name,
      'server_id', r_server,
      'server_name', srv.name,
      'conversation_id', m.conversation_id,
      'is_group', conv.is_group,
      'group_name', conv.name
    );
  elsif report_kind = 'user' then
    select * into t from public.profiles p where p.id = target;
    if not found or t.deleted_at is not null or t.banned_at is not null then
      raise exception 'user not found';
    end if;
    if t.id = me then
      raise exception 'cannot report yourself';
    end if;
    r_target := t.id;
    snap := jsonb_build_object(
      'user_id', t.id, 'username', t.username, 'display_name', t.display_name,
      'avatar_url', t.avatar_url, 'bio', t.bio, 'status', t.status
    );
  else
    select * into srv from public.servers s where s.id = target;
    if not found or not (srv.is_public or public.is_server_member(target)) then
      raise exception 'server not found';
    end if;
    if srv.owner_id = me then
      raise exception 'cannot report your own server';
    end if;
    r_server := srv.id;
    snap := jsonb_build_object(
      'server_id', srv.id, 'name', srv.name, 'icon_url', srv.icon_url,
      'description', srv.description, 'owner_id', srv.owner_id, 'is_public', srv.is_public
    );
  end if;

  if exists (
    select 1 from public.reports x
    where x.reporter_id = me and x.kind = report_kind and x.status = 'open'
      and case report_kind when 'message' then x.message_id = target
                           when 'user' then x.target_user_id = target
                           else x.server_id = target end
  ) then
    raise exception 'already reported';
  end if;

  insert into public.reports (reporter_id, kind, message_id, target_user_id, server_id, conversation_id,
                              snapshot, reason, note, admin_only)
    values (me, report_kind, case when report_kind = 'message' then target end, r_target, r_server, r_conv,
            snap, report_reason, n, r_admin_only)
    returning id into new_id;
  return new_id;
exception
  when unique_violation then
    raise exception 'already reported';
end $$;
revoke execute on function public.create_report(text, uuid, text, text) from public, anon;
grant execute on function public.create_report(text, uuid, text, text) to authenticated;

-- Mark a report handled. Errors: 'report not found' (missing or not yours to see),
-- 'already handled', 'note too long'.
create or replace function public.handle_report(report_id uuid, note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  rep public.reports;
  n text := nullif(btrim(public.strip_invisible(coalesce(note, ''))), '');
begin
  perform public.require_live_account();
  select * into rep from public.reports x where x.id = report_id for update;
  if not found or not public.can_view_report(rep.server_id, rep.kind, rep.admin_only, rep.target_user_id) then
    raise exception 'report not found';
  end if;
  if rep.status = 'handled' then
    raise exception 'already handled';
  end if;
  if n is not null and char_length(n) > 500 then
    raise exception 'note too long';
  end if;
  update public.reports x set status = 'handled', handled_by = auth.uid(), handled_note = n, handled_at = now()
    where x.id = report_id;
end $$;
revoke execute on function public.handle_report(uuid, text) from public, anon;
grant execute on function public.handle_report(uuid, text) to authenticated;

-- ---------- 6. moderator message delete ----------
alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check check (
  action in ('kick', 'ban', 'unban', 'timeout', 'timeout_removed', 'sticker_create', 'sticker_delete',
             'ownership_transfer', 'message_delete')
);

-- Errors: 'message not found' (missing or not visible), 'not permitted' (a DM/group message, or no
-- manage_messages in its server). Deleting your own message this way isn't logged.
create or replace function public.delete_message_as_mod(msg uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.messages;
  srv uuid;
begin
  perform public.require_live_account();
  select * into m from public.messages x where x.id = msg for update;
  if not found or not public.can_read_message(msg) then
    raise exception 'message not found';
  end if;
  if m.channel_id is null then
    raise exception 'not permitted';
  end if;
  select c.server_id into srv from public.channels c where c.id = m.channel_id;
  if not public.has_server_permission(srv, 'manage_messages') then
    raise exception 'not permitted';
  end if;
  delete from public.messages x where x.id = msg;
  if m.author_id <> auth.uid() then
    insert into public.audit_log (server_id, action, actor_id, target_id)
      values (srv, 'message_delete', auth.uid(), m.author_id);
  end if;
end $$;
revoke execute on function public.delete_message_as_mod(uuid) from public, anon;
grant execute on function public.delete_message_as_mod(uuid) to authenticated;

-- The attachments-bucket path of a message file URL (null if it isn't one). Internal.
create or replace function public.attachment_path(url text)
returns text language sql immutable set search_path = public as $$
  select substring(url from '^https://dpsikhsxdwigeuyonfch\.supabase\.co/storage/v1/object/public/attachments/([A-Za-z0-9_./-]+)$');
$$;
revoke execute on function public.attachment_path(text) from public, anon, authenticated;

-- ---------- 7. site bans ----------
create table public.site_bans (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  banned_by uuid references public.profiles(id) on delete set null,
  reason text check (reason is null or char_length(reason) <= 512),
  deleted_messages boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.site_bans enable row level security;
revoke all on public.site_bans from anon, authenticated;
grant select on public.site_bans to authenticated;
create policy "site admin reads site bans" on public.site_bans for select to authenticated
  using (public.is_site_admin());

-- Admin only. Returns the storage files the app should remove (attachments of deleted messages;
-- none unless delete_messages). Errors: 'not permitted', 'you cannot ban yourself',
-- 'cannot ban a site admin', 'user not found', 'already banned',
-- 'transfer or delete their servers first'.
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

  -- Group chats they own pass to a random other member (live ones first). They stay a member.
  for g in select c.id from public.conversations c where c.is_group and c.owner_id = target for update loop
    select m.user_id into next_owner from public.conversation_members m
      join public.profiles p on p.id = m.user_id
      where m.conversation_id = g and m.user_id <> target
      order by (p.deleted_at is null and p.banned_at is null) desc, random() limit 1;
    if next_owner is not null then
      update public.conversations c set owner_id = next_owner where c.id = g;
    end if;
  end loop;

  insert into public.site_bans (user_id, banned_by, reason, deleted_messages)
    values (target, auth.uid(), public.clean_reason(site_ban.reason), coalesce(delete_messages, false));
  update public.profiles p set banned_at = now() where p.id = target;

  -- Supabase Auth: no sign-in, no token refresh, current sessions gone.
  update auth.users u set banned_until = now() + interval '100 years' where u.id = target;
  delete from auth.refresh_tokens r where r.user_id = target::text;
  delete from auth.sessions s where s.user_id = target;

  if coalesce(delete_messages, false) then
    return query
      select distinct 'attachments'::text, x.p from (
        select public.attachment_path(m.image_url) as p from public.messages m where m.author_id = target
        union all
        select public.attachment_path(m.file_url) from public.messages m where m.author_id = target
      ) x where x.p is not null;
    delete from public.messages m where m.author_id = target;
  end if;
end $$;
revoke execute on function public.site_ban(uuid, boolean, text) from public, anon;
grant execute on function public.site_ban(uuid, boolean, text) to authenticated;

-- Admin only. Errors: 'not permitted', 'not banned'.
create or replace function public.site_unban(target uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_site_admin() then
    raise exception 'not permitted';
  end if;
  perform 1 from public.profiles p where p.id = target for update;
  delete from public.site_bans b where b.user_id = target;
  if not found then
    raise exception 'not banned';
  end if;
  update public.profiles p set banned_at = null where p.id = target;
  update auth.users u set banned_until = null where u.id = target;
end $$;
revoke execute on function public.site_unban(uuid) from public, anon;
grant execute on function public.site_unban(uuid) to authenticated;

-- ---------- 8. admin tools ----------

-- Admin only: a reported message, or one the admin can read. Returns its attachment files for
-- the app to remove. A server message is logged as `message_delete`. Errors: 'not permitted',
-- 'message not found'.
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
  return query
    select distinct 'attachments'::text, x.p from (
      select public.attachment_path(m.image_url) as p
      union all select public.attachment_path(m.file_url)
    ) x where x.p is not null;
end $$;
revoke execute on function public.admin_delete_message(uuid) from public, anon;
grant execute on function public.admin_delete_message(uuid) to authenticated;

-- Admin only: deletes any server (everything in it cascades, as with delete_server). Returns its
-- icon and sticker files for the app to remove. Errors: 'not permitted', 'server not found'.
create or replace function public.admin_delete_server(srv uuid)
returns table (bucket text, path text) language plpgsql security definer set search_path = public as $$
begin
  if not public.is_site_admin() then
    raise exception 'not permitted';
  end if;
  perform 1 from public.servers s where s.id = srv for update;
  if not found then
    raise exception 'server not found';
  end if;
  return query
    select o.bucket_id::text, o.name::text from storage.objects o
    where o.bucket_id in ('server-icons', 'stickers') and o.name like srv::text || '/%';
  delete from public.servers s where s.id = srv;
end $$;
revoke execute on function public.admin_delete_server(uuid) from public, anon;
grant execute on function public.admin_delete_server(uuid) to authenticated;

-- Admin only: hand a server to one of its live members. Logged as `ownership_transfer`.
-- Errors: 'not permitted', 'server not found', 'they already own this server', 'not a member'.
create or replace function public.admin_transfer_server(srv uuid, new_owner uuid)
returns void language plpgsql security definer set search_path = public as $$
declare cur uuid;
begin
  if not public.is_site_admin() then
    raise exception 'not permitted';
  end if;
  select s.owner_id into cur from public.servers s where s.id = srv for update;
  if not found then
    raise exception 'server not found';
  end if;
  if new_owner = cur then
    raise exception 'they already own this server';
  end if;
  perform 1 from public.profiles p
    where p.id = new_owner and p.deleted_at is null and p.banned_at is null for update;
  if not found
     or not exists (select 1 from public.server_members m where m.server_id = srv and m.user_id = new_owner) then
    raise exception 'not a member';
  end if;
  update public.servers s set owner_id = new_owner where s.id = srv;
  insert into public.audit_log (server_id, action, actor_id, target_id)
    values (srv, 'ownership_transfer', auth.uid(), new_owner);
end $$;
revoke execute on function public.admin_transfer_server(uuid, uuid) from public, anon;
grant execute on function public.admin_transfer_server(uuid, uuid) to authenticated;

-- Admin only: the servers a person owns (the ban dialog's hand-off step). Error: 'not permitted'.
create or replace function public.admin_user_servers(target uuid)
returns table (id uuid, name text, icon_url text, member_count bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_site_admin() then
    raise exception 'not permitted';
  end if;
  return query
    select s.id, s.name, s.icon_url, (select count(*) from public.server_members m where m.server_id = s.id)
    from public.servers s where s.owner_id = target order by s.name;
end $$;
revoke execute on function public.admin_user_servers(uuid) from public, anon;
grant execute on function public.admin_user_servers(uuid) to authenticated;

-- Admin only: a server's live members other than its owner (the "Give to…" picker).
create or replace function public.admin_server_members(srv uuid)
returns table (user_id uuid, username text, display_name text, avatar_url text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_site_admin() then
    raise exception 'not permitted';
  end if;
  return query
    select p.id, p.username, p.display_name, p.avatar_url
    from public.server_members m
    join public.profiles p on p.id = m.user_id
    join public.servers s on s.id = m.server_id
    where m.server_id = srv and m.user_id is distinct from s.owner_id
      and p.deleted_at is null and p.banned_at is null
    order by lower(p.display_name);
end $$;
revoke execute on function public.admin_server_members(uuid) from public, anon;
grant execute on function public.admin_server_members(uuid) to authenticated;

-- Admin only: every server, optionally filtered by name (case-insensitive substring), max 100.
create or replace function public.admin_list_servers(search text default null)
returns table (id uuid, name text, icon_url text, owner_id uuid, is_public boolean, member_count bigint, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare q text := nullif(btrim(coalesce(search, '')), '');
begin
  if not public.is_site_admin() then
    raise exception 'not permitted';
  end if;
  return query
    select s.id, s.name, s.icon_url, s.owner_id, s.is_public,
           (select count(*) from public.server_members m where m.server_id = s.id), s.created_at
    from public.servers s
    where q is null or strpos(lower(s.name), lower(q)) > 0
    order by lower(s.name)
    limit 100;
end $$;
revoke execute on function public.admin_list_servers(text) from public, anon;
grant execute on function public.admin_list_servers(text) to authenticated;

-- ---------- 9. storage ----------
drop policy if exists "site admin reads any object" on storage.objects;
create policy "site admin reads any object" on storage.objects for select to authenticated
  using (public.is_site_admin());
drop policy if exists "site admin deletes any object" on storage.objects;
create policy "site admin deletes any object" on storage.objects for delete to authenticated
  using (public.is_site_admin());
