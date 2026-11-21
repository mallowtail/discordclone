-- 0054: free-plan limits (spec: docs/superpowers/specs/2026-11-21-free-plan-limits-design.md).
--
--  1. Limits live in three small functions (20 MB per person per Korea day; 1 GB storage;
--     500 MB database).
--  2. Upload quota: upload_quota_used(uid) = bytes that person uploaded today (Asia/Seoul day) across
--     attachments / avatars / server-icons / stickers (storage.objects.owner_id). The four storage
--     insert policies also need upload_allowed(): under the daily quota and total storage < 95%.
--     The check runs on the files already stored, so an upload that starts under the limit finishes
--     (a day can end a little over). upload_status() tells the app how much is left / if paused.
--  3. "Keep this message": messages.kept, set_message_kept(msg, keep). The author; in servers also
--     Manage Messages; in DMs/groups any member. The app can't set it any other way.
--  4. Clean-up, run by the expire-uploads Edge Function (service role only):
--       cleanup_start → expire_uploads('age') → expire_uploads('pressure') → expire_messages
--       → cleanup_finish, with cleanup_files_done after each batch of files the function removed.
--     Rewritten messages keep their text and get a "removed" line in place of the picture/file
--     (also inside forwarded copies). Files are queued in cleanup_file_queue and handed to the
--     function only if the storage object belongs to the message's author and no message or
--     forwarded copy still points at it. A file the function failed to remove stays queued and is
--     handed out again next run.
--  5. cleanup_runs: one row per run (site admin reads it). admin_usage() for the /admin Usage tab.
--  6. Daily pg_cron job at 19:00 UTC (04:00 Asia/Seoul) → pg_net POST to the function with a random
--     secret kept in Vault. The site admin's "Run clean-up now" calls the function with their own
--     login; the function checks is_site_admin() for that login.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ---------- 1. limits ----------
create or replace function public.limit_daily_upload_bytes()
returns bigint language sql immutable as $$ select 20::bigint * 1024 * 1024 $$;
create or replace function public.limit_storage_bytes()
returns bigint language sql immutable as $$ select 1024::bigint * 1024 * 1024 $$;
create or replace function public.limit_database_bytes()
returns bigint language sql immutable as $$ select 500::bigint * 1024 * 1024 $$;
grant execute on function public.limit_daily_upload_bytes() to authenticated, service_role;
grant execute on function public.limit_storage_bytes() to authenticated, service_role;
grant execute on function public.limit_database_bytes() to authenticated, service_role;

-- ---------- 2. upload quota + pause ----------

-- Bytes stored across all buckets. Internal.
create or replace function public.storage_total_bytes()
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(sum(coalesce((o.metadata->>'size')::bigint, 0)), 0)::bigint from storage.objects o;
$$;
revoke execute on function public.storage_total_bytes() from public, anon, authenticated;

-- Start of today in Korea (Asia/Seoul midnight), as a timestamptz. Internal.
create or replace function public.korea_day_start()
returns timestamptz language sql stable as $$
  select date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
$$;

-- Bytes the person uploaded today (Korea day) to the four upload buckets. Yourself only (or the
-- site admin). Error: 'not permitted'.
create or replace function public.upload_quota_used(uid uuid)
returns bigint language plpgsql stable security definer set search_path = public as $$
begin
  if uid is null or (uid is distinct from auth.uid() and not public.is_site_admin()) then
    raise exception 'not permitted';
  end if;
  return (
    select coalesce(sum(coalesce((o.metadata->>'size')::bigint, 0)), 0)::bigint
    from storage.objects o
    where o.owner_id = uid::text
      and o.bucket_id in ('attachments', 'avatars', 'server-icons', 'stickers')
      and o.created_at >= public.korea_day_start()
  );
end $$;
revoke execute on function public.upload_quota_used(uuid) from public, anon;
grant execute on function public.upload_quota_used(uuid) to authenticated;

-- Used by the storage insert policies: signed in, under today's quota, storage under 95%.
create or replace function public.upload_allowed()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
    and public.upload_quota_used(auth.uid()) < public.limit_daily_upload_bytes()
    and public.storage_total_bytes() < public.limit_storage_bytes() * 0.95;
$$;
revoke execute on function public.upload_allowed() from public, anon;
grant execute on function public.upload_allowed() to authenticated;

-- For the app, before an upload: {used_bytes, limit_bytes, remaining_bytes, paused}.
-- paused = storage is at 95% or more (uploads refused for everyone). Error: 'not signed in'.
create or replace function public.upload_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare used bigint;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  used := public.upload_quota_used(auth.uid());
  return jsonb_build_object(
    'used_bytes', used,
    'limit_bytes', public.limit_daily_upload_bytes(),
    'remaining_bytes', greatest(public.limit_daily_upload_bytes() - used, 0),
    'paused', public.storage_total_bytes() >= public.limit_storage_bytes() * 0.95
  );
end $$;
revoke execute on function public.upload_status() from public, anon;
grant execute on function public.upload_status() to authenticated;

-- The four insert policies, each as it is now (attachments: dashboard-made, bucket only; avatars:
-- 0004; server-icons: 0050; stickers: 0044) plus upload_allowed().
drop policy if exists "authenticated upload attachments" on storage.objects;
create policy "authenticated upload attachments" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.upload_allowed());

drop policy if exists "authenticated upload avatars" on storage.objects;
create policy "authenticated upload avatars" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and public.upload_allowed());

drop policy if exists "icon managers upload server-icons" on storage.objects;
create policy "icon managers upload server-icons" on storage.objects for insert to authenticated
  with check (bucket_id = 'server-icons'
    and public.has_server_permission(public.storage_folder_uuid(name), 'manage_server_icon')
    and public.upload_allowed());

drop policy if exists "managers upload stickers" on storage.objects;
create policy "managers upload stickers" on storage.objects for insert to authenticated
  with check (bucket_id = 'stickers'
    and public.has_server_permission(public.sticker_folder_server(name), 'manage_stickers')
    and public.upload_allowed());

-- ---------- 3. keep this message ----------
alter table public.messages add column if not exists kept boolean not null default false;

-- The app (direct client) can't set kept on insert or change it on update; set_message_kept can.
create or replace function public.guard_message_kept()
returns trigger language plpgsql as $$
begin
  if not public.is_direct_client() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.kept := false;
  elsif new.kept is distinct from old.kept then
    raise exception 'only the message text can be edited';
  end if;
  return new;
end $$;
revoke execute on function public.guard_message_kept() from public, anon, authenticated;
drop trigger if exists messages_guard_kept on public.messages;
create trigger messages_guard_kept before insert or update on public.messages
  for each row execute function public.guard_message_kept();

-- Errors: 'message not found' (missing or not visible), 'not permitted'.
create or replace function public.set_message_kept(msg uuid, keep boolean)
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
  if m.author_id <> auth.uid() then
    if m.channel_id is not null then
      select c.server_id into srv from public.channels c where c.id = m.channel_id;
      if not public.has_server_permission(srv, 'manage_messages') then
        raise exception 'not permitted';
      end if;
    elsif not public.is_conversation_member(m.conversation_id) then
      raise exception 'not permitted';
    end if;
  end if;
  update public.messages x set kept = coalesce(keep, false) where x.id = msg;
end $$;
revoke execute on function public.set_message_kept(uuid, boolean) from public, anon;
grant execute on function public.set_message_kept(uuid, boolean) to authenticated;

-- ---------- 4. clean-up ----------

create table if not exists public.cleanup_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  trigger text not null check (trigger in ('cron', 'admin')),
  actor_id uuid references public.profiles(id) on delete set null,
  steps text[] not null default '{}',     -- what actually did work: 'age', 'pressure', 'messages'
  messages_changed integer not null default 0,  -- pictures/files turned into a text line
  messages_deleted integer not null default 0,  -- database safety net
  files_deleted integer not null default 0,
  bytes_freed bigint not null default 0,
  storage_bytes bigint,                    -- at the start of the run
  database_bytes bigint,                   -- at the start of the run
  error text
);
create index if not exists cleanup_runs_started on public.cleanup_runs (started_at desc);
alter table public.cleanup_runs enable row level security;
revoke all on public.cleanup_runs from anon, authenticated;
grant select on public.cleanup_runs to authenticated;
drop policy if exists "site admin reads cleanup runs" on public.cleanup_runs;
create policy "site admin reads cleanup runs" on public.cleanup_runs for select to authenticated
  using (public.is_site_admin());

-- Files waiting to be removed by the function (attachments bucket only). No app access.
create table if not exists public.cleanup_file_queue (
  path text primary key,
  owner_id uuid not null,     -- the author of the message it came from (= the object's owner)
  bytes bigint not null default 0,
  queued_at timestamptz not null default now()
);
alter table public.cleanup_file_queue enable row level security;
revoke all on public.cleanup_file_queue from anon, authenticated;

-- Public URL of an attachments-bucket path. Internal.
create or replace function public.attachment_url(path text)
returns text language sql immutable as $$
  select 'https://dpsikhsxdwigeuyonfch.supabase.co/storage/v1/object/public/attachments/' || path;
$$;
revoke execute on function public.attachment_url(text) from public, anon, authenticated;

-- True if any message or forwarded copy still points at this attachments path. Internal.
create or replace function public.attachment_in_use(path text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.messages m
    where m.image_url = public.attachment_url(path)
       or m.file_url = public.attachment_url(path)
       or m.forward_snapshot->>'image_url' = public.attachment_url(path)
       or m.forward_snapshot->>'file_url' = public.attachment_url(path)
  );
$$;
revoke execute on function public.attachment_in_use(text) from public, anon, authenticated;

-- Message text with the picture/file replaced by a line (Call 2). reason: 'age' or 'pressure'.
-- Stays within the 2000-character limit (the original text is shortened if it has to be).
create or replace function public.removed_upload_text(content text, image_url text, file_url text,
                                                      file_name text, reason text)
returns text language plpgsql immutable as $$
declare
  why text := case when reason = 'age' then 'removed after 30 days' else 'removed to free space' end;
  lines text := '';
  body text := coalesce(content, '');
begin
  if image_url is not null then
    lines := '🖼 picture ' || why;
  end if;
  if file_url is not null then
    lines := lines || case when lines = '' then '' else E'\n' end
             || '📎 ' || coalesce(nullif(left(file_name, 200), ''), 'file') || ' — ' || why;
  end if;
  if lines = '' then
    return body;
  end if;
  if body = '' then
    return lines;
  end if;
  if char_length(body) + 1 + char_length(lines) > 2000 then
    body := left(body, 2000 - 2 - char_length(lines)) || '…';
  end if;
  return body || E'\n' || lines;
end $$;

-- Turns one message's picture/file into text (and in forwarded copies of it), and queues the
-- author's own files. Returns the bytes those queued files take (0 if none / still in use).
-- Internal; the caller holds the row lock.
create or replace function public.strip_message_upload(m public.messages, reason text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  f record;
  freed bigint := 0;
  sz bigint;
begin
  update public.messages x set
      content = public.removed_upload_text(x.content, x.image_url, x.file_url, x.file_name, reason),
      image_url = null, file_url = null, file_name = null
    where x.id = m.id;
  update public.messages x set forward_snapshot = x.forward_snapshot
        || jsonb_build_object(
             'content', public.removed_upload_text(x.forward_snapshot->>'content',
                          x.forward_snapshot->>'image_url', x.forward_snapshot->>'file_url',
                          x.forward_snapshot->>'file_name', reason),
             'image_url', null, 'file_url', null, 'file_name', null)
    where x.forward_snapshot is not null
      and x.forward_snapshot->>'message_id' = m.id::text
      and (x.forward_snapshot->>'image_url' is not null or x.forward_snapshot->>'file_url' is not null);
  for f in select * from public.message_own_files(m.author_id, m.image_url, m.file_url) loop
    if not public.attachment_in_use(f.path) then
      select coalesce((o.metadata->>'size')::bigint, 0) into sz
        from storage.objects o where o.bucket_id = 'attachments' and o.name = f.path;
      insert into public.cleanup_file_queue (path, owner_id, bytes)
        values (f.path, m.author_id, coalesce(sz, 0))
        on conflict on constraint cleanup_file_queue_pkey do nothing;
      if found then
        freed := freed + coalesce(sz, 0);
      end if;
    end if;
  end loop;
  return freed;
end $$;
revoke execute on function public.strip_message_upload(public.messages, text) from public, anon, authenticated;

-- The queued files that may be removed now: still in storage, still owned by the author they were
-- queued for, and not pointed at by any message or forwarded copy. Queue rows that no longer
-- qualify are dropped. Internal.
create or replace function public.cleanup_pending_files()
returns table (bucket text, path text, bytes bigint) language plpgsql security definer set search_path = public as $$
begin
  delete from public.cleanup_file_queue q
    where not exists (select 1 from storage.objects o
                      where o.bucket_id = 'attachments' and o.name = q.path and o.owner_id = q.owner_id::text)
       or public.attachment_in_use(q.path);
  return query
    select 'attachments'::text, q.path, q.bytes from public.cleanup_file_queue q order by q.queued_at, q.path;
end $$;
revoke execute on function public.cleanup_pending_files() from public, anon, authenticated;

-- Starts a run. trigger 'cron' or 'admin' (actor = the admin). An earlier run left unfinished is
-- marked with an error. Error: 'a clean-up is already running' (one started < 10 minutes ago).
create or replace function public.cleanup_start(trigger text, actor uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare run uuid;
begin
  perform pg_advisory_xact_lock(hashtext('public.cleanup_start'));
  if exists (select 1 from public.cleanup_runs r
             where r.finished_at is null and r.started_at > now() - interval '10 minutes') then
    raise exception 'a clean-up is already running';
  end if;
  update public.cleanup_runs r set finished_at = now(),
      error = coalesce(r.error, 'stopped before finishing')
    where r.finished_at is null;
  insert into public.cleanup_runs (trigger, actor_id, storage_bytes, database_bytes)
    values (cleanup_start.trigger, actor, public.storage_total_bytes(), pg_database_size(current_database()))
    returning id into run;
  return run;
end $$;
revoke execute on function public.cleanup_start(text, uuid) from public, anon, authenticated;
grant execute on function public.cleanup_start(text, uuid) to service_role;

-- mode 'age': messages older than 30 days lose their picture/file (up to 5000 a run).
-- mode 'pressure': only if storage (minus files already queued) is at 80% or more; the oldest
--   messages with a picture/file lose it until under 75% (unpinned, unkept ones first).
-- Returns the files to remove now (see cleanup_pending_files). Service role only.
create or replace function public.expire_uploads(mode text, run uuid)
returns table (bucket text, path text, bytes bigint) language plpgsql security definer set search_path = public as $$
declare
  m public.messages;
  changed integer := 0;
  used bigint;
begin
  if mode = 'age' then
    for m in
      select * from public.messages x
      where (x.image_url is not null or x.file_url is not null)
        and x.created_at < now() - interval '30 days'
      order by x.created_at, x.id
      limit 5000
      for update skip locked
    loop
      perform public.strip_message_upload(m, 'age');
      changed := changed + 1;
    end loop;
  elsif mode = 'pressure' then
    used := public.storage_total_bytes()
            - coalesce((select sum(q.bytes) from public.cleanup_file_queue q), 0);
    if used >= public.limit_storage_bytes() * 0.80 then
      for m in
        select * from public.messages x
        where x.image_url is not null or x.file_url is not null
        order by (x.pinned or x.kept), x.created_at, x.id
        for update skip locked
      loop
        exit when used < public.limit_storage_bytes() * 0.75;
        used := used - public.strip_message_upload(m, 'pressure');
        changed := changed + 1;
      end loop;
    end if;
  else
    raise exception 'unknown mode';
  end if;
  if changed > 0 then
    update public.cleanup_runs r set
        messages_changed = r.messages_changed + changed,
        steps = r.steps || mode
      where r.id = run;
  end if;
  return query select * from public.cleanup_pending_files();
end $$;
revoke execute on function public.expire_uploads(text, uuid) from public, anon, authenticated;
grant execute on function public.expire_uploads(text, uuid) to service_role;

-- Database safety net: if the database is at 80% or more of 500 MB, the oldest messages that are
-- neither pinned nor kept are deleted until about 5% under (an estimate from row sizes, since
-- Postgres doesn't shrink its files after a delete; the freed space is reused). It doesn't run
-- again until the database grows past its size at the last such deletion, so the same day's
-- unshrunk size can't trigger it twice. Their authors' own files are queued.
-- Returns the files to remove now. Service role only.
create or replace function public.expire_messages(run uuid)
returns table (bucket text, path text, bytes bigint) language plpgsql security definer set search_path = public as $$
declare
  size bigint := pg_database_size(current_database());
  last_size bigint;
  need bigint;
  ids uuid[];
  m public.messages;
  f record;
  sz bigint;
begin
  select r.database_bytes into last_size from public.cleanup_runs r
    where r.messages_deleted > 0 and r.id <> run
    order by r.started_at desc limit 1;
  if size >= public.limit_database_bytes() * 0.80
     and (last_size is null or size > last_size + 1024 * 1024) then
    need := size - (public.limit_database_bytes() * 0.75)::bigint;
    -- Oldest first, until the running estimate (row size + half again for indexes) reaches it.
    select array_agg(t.id) into ids from (
      select x.id,
             pg_column_size(x.*)::bigint * 3 / 2 as own,
             sum(pg_column_size(x.*)::bigint * 3 / 2) over (order by x.created_at, x.id) as running
      from public.messages x
      where not x.pinned and not x.kept
    ) t
    where t.running - t.own < need;
    if ids is not null then
      for m in select * from public.messages x where x.id = any(ids) for update loop
        for f in select * from public.message_own_files(m.author_id, m.image_url, m.file_url) loop
          select coalesce((o.metadata->>'size')::bigint, 0) into sz
            from storage.objects o where o.bucket_id = 'attachments' and o.name = f.path;
          insert into public.cleanup_file_queue (path, owner_id, bytes)
            values (f.path, m.author_id, coalesce(sz, 0))
            on conflict on constraint cleanup_file_queue_pkey do nothing;
        end loop;
      end loop;
      delete from public.messages x where x.id = any(ids) and not x.pinned and not x.kept;
      update public.cleanup_runs r set
          messages_deleted = r.messages_deleted + coalesce(array_length(ids, 1), 0),
          database_bytes = size,
          steps = r.steps || 'messages'::text
        where r.id = run;
    end if;
  end if;
  return query select * from public.cleanup_pending_files();
end $$;
revoke execute on function public.expire_messages(uuid) from public, anon, authenticated;
grant execute on function public.expire_messages(uuid) to service_role;

-- The function removed these attachments-bucket paths: drop them from the queue, count them.
create or replace function public.cleanup_files_done(run uuid, paths text[])
returns void language plpgsql security definer set search_path = public as $$
declare n integer; b bigint;
begin
  with gone as (
    delete from public.cleanup_file_queue q where q.path = any(paths) returning q.bytes
  ) select count(*), coalesce(sum(gone.bytes), 0) into n, b from gone;
  update public.cleanup_runs r set
      files_deleted = r.files_deleted + n,
      bytes_freed = r.bytes_freed + b
    where r.id = run;
end $$;
revoke execute on function public.cleanup_files_done(uuid, text[]) from public, anon, authenticated;
grant execute on function public.cleanup_files_done(uuid, text[]) to service_role;

create or replace function public.cleanup_finish(run uuid, error text default null)
returns void language sql security definer set search_path = public as $$
  update public.cleanup_runs r set finished_at = now(), error = left(cleanup_finish.error, 2000)
    where r.id = run;
$$;
revoke execute on function public.cleanup_finish(uuid, text) from public, anon, authenticated;
grant execute on function public.cleanup_finish(uuid, text) to service_role;

-- The cron job's secret (random, made here, kept in Vault).
do $$
begin
  if not exists (select 1 from vault.secrets s where s.name = 'cleanup_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'cleanup_cron_secret',
                                'expire-uploads Edge Function: shared secret for the daily cron call');
  end if;
end $$;

-- The function checks the x-cleanup-secret header with this. Service role only.
create or replace function public.cleanup_secret_ok(given text)
returns boolean language sql stable security definer set search_path = public as $$
  select given is not null and char_length(given) >= 32 and exists (
    select 1 from vault.decrypted_secrets s where s.name = 'cleanup_cron_secret' and s.decrypted_secret = given
  );
$$;
revoke execute on function public.cleanup_secret_ok(text) from public, anon, authenticated;
grant execute on function public.cleanup_secret_ok(text) to service_role;

-- ---------- 5. /admin Usage ----------
-- Error: 'not permitted'.
create or replace function public.admin_usage()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_site_admin() then
    raise exception 'not permitted';
  end if;
  return jsonb_build_object(
    'storage', jsonb_build_object(
      'total_bytes', public.storage_total_bytes(),
      'limit_bytes', public.limit_storage_bytes(),
      'warn_at', 0.80,
      'pause_at', 0.95,
      'paused', public.storage_total_bytes() >= public.limit_storage_bytes() * 0.95,
      'buckets', (
        select coalesce(jsonb_object_agg(b.id, coalesce(s.bytes, 0)), '{}'::jsonb)
        from storage.buckets b
        left join (select o.bucket_id, sum(coalesce((o.metadata->>'size')::bigint, 0))::bigint as bytes
                   from storage.objects o group by o.bucket_id) s on s.bucket_id = b.id
      )
    ),
    'database', jsonb_build_object(
      'bytes', pg_database_size(current_database()),
      'limit_bytes', public.limit_database_bytes(),
      'warn_at', 0.80
    ),
    'daily_upload_limit_bytes', public.limit_daily_upload_bytes(),
    'pending_files', (select count(*) from public.cleanup_file_queue),
    'runs', (
      select coalesce(jsonb_agg(to_jsonb(r) order by r.started_at desc), '[]'::jsonb)
      from (select * from public.cleanup_runs order by started_at desc limit 10) r
    )
  );
end $$;
revoke execute on function public.admin_usage() from public, anon;
grant execute on function public.admin_usage() to authenticated;

-- ---------- 6. daily schedule: 04:00 Asia/Seoul = 19:00 UTC ----------
do $$
begin
  if exists (select 1 from cron.job j where j.jobname = 'expire-uploads-daily') then
    perform cron.unschedule('expire-uploads-daily');
  end if;
  perform cron.schedule('expire-uploads-daily', '0 19 * * *', $job$
    select net.http_post(
      url := 'https://dpsikhsxdwigeuyonfch.supabase.co/functions/v1/expire-uploads',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cleanup-secret', (select s.decrypted_secret from vault.decrypted_secrets s
                             where s.name = 'cleanup_cron_secret')),
      body := '{"trigger":"cron"}'::jsonb,
      timeout_milliseconds := 120000
    );
  $job$);
end $$;
