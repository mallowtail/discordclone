-- 0055: fixes for 0054 (free-plan limits) after review.
--
--  1. Pinned or kept messages keep their files: the 30-day rule skips them. (The 80% storage rule
--     still reaches them, but only after every other message.)
--  2. Orphan clean-up: an attachments-bucket file more than a day old that no message or forwarded
--     copy points at (its message was deleted, or it was uploaded and never sent) is queued for
--     removal. Same hand-out re-check as everything else (still exists, same owner, not in use).
--  3. Upload limits on every upload path. RLS (0054) only sees committed rows, so parallel uploads
--     all passed "used < 20 MB", and Storage's signed upload URLs are checked by RLS only when the
--     URL is made — the upload through it is inserted by Storage itself without RLS (tested: three
--     signed URLs made at 0 MB took 30 MB). A trigger on storage.objects now checks every new or
--     growing object in the four buckets, one at a time (advisory lock), against committed rows:
--       - pause: refused if storage (other files) is already at 95% of 1 GB;
--       - quota: refused if the owner had already uploaded 20 MB today (Korea day).
--     Both as in Call 1: an upload that starts under the line finishes, so the worst cases are
--     20 MB minus a byte plus one file per person per day (≤ 25 MB attachments, ≤ 5 MB avatars /
--     icons, ≤ 512 KB stickers), and 95% plus one file (< 97.5% of 1 GB) for storage. Same lines as
--     the RLS checks and upload_status, so "paused" is a state the app can actually show.
--     Storage puts the file size in metadata at insert (tested); a size that only arrives later by
--     update is checked then. The RLS checks stay for the early, friendly refusal.
--  4. attachment_in_use uses indexes (no full scan of messages); the age/pressure work is capped
--     at 1000 messages per run so a run stays well inside statement time limits.
--  5. set_message_kept checks read access before taking the row lock.
--  6. cleanup_record_failure: the function records a failed run when cleanup_start itself fails.

-- ---------- 3. upload limits on every path ----------
create or replace function public.enforce_upload_limits()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sz bigint := coalesce((new.metadata->>'size')::bigint, 0);
  old_sz bigint := 0;
  others bigint;
  used bigint;
begin
  if new.bucket_id not in ('attachments', 'avatars', 'server-icons', 'stickers') then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    old_sz := coalesce((old.metadata->>'size')::bigint, 0);
    if sz <= old_sz and new.owner_id is not distinct from old.owner_id then
      return new;  -- nothing grew
    end if;
  end if;
  -- One upload at a time, so each one counts the ones committed before it.
  perform pg_advisory_xact_lock(hashtext('public.enforce_upload_limits'));
  select coalesce(sum(coalesce((o.metadata->>'size')::bigint, 0)), 0) into others
    from storage.objects o where o.id is distinct from new.id;
  if others >= public.limit_storage_bytes() * 0.95 then
    raise exception 'uploads are paused: storage is almost full';
  end if;
  if new.owner_id is not null then
    select coalesce(sum(coalesce((o.metadata->>'size')::bigint, 0)), 0) into used
      from storage.objects o
      where o.owner_id = new.owner_id
        and o.bucket_id in ('attachments', 'avatars', 'server-icons', 'stickers')
        and o.created_at >= public.korea_day_start()
        and o.id is distinct from new.id;
    if used >= public.limit_daily_upload_bytes() then
      raise exception 'daily upload limit reached';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.enforce_upload_limits() from public, anon, authenticated;
drop trigger if exists enforce_upload_limits on storage.objects;
create trigger enforce_upload_limits before insert or update of metadata, owner_id on storage.objects
  for each row execute function public.enforce_upload_limits();

-- ---------- 4. indexes for "is this file still used?" ----------
create index if not exists messages_image_url_used on public.messages (image_url) where image_url is not null;
create index if not exists messages_file_url_used on public.messages (file_url) where file_url is not null;
create index if not exists messages_fwd_image_url_used on public.messages ((forward_snapshot->>'image_url'))
  where (forward_snapshot->>'image_url') is not null;
create index if not exists messages_fwd_file_url_used on public.messages ((forward_snapshot->>'file_url'))
  where (forward_snapshot->>'file_url') is not null;
create index if not exists messages_with_upload_created on public.messages (created_at, id)
  where image_url is not null or file_url is not null;

-- Same as 0054, written as four lookups so each uses its index.
create or replace function public.attachment_in_use(path text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.messages m where m.image_url = public.attachment_url(path))
      or exists (select 1 from public.messages m where m.file_url = public.attachment_url(path))
      or exists (select 1 from public.messages m where (m.forward_snapshot->>'image_url') = public.attachment_url(path))
      or exists (select 1 from public.messages m where (m.forward_snapshot->>'file_url') = public.attachment_url(path));
$$;
revoke execute on function public.attachment_in_use(text) from public, anon, authenticated;

-- ---------- 1. age skips pinned/kept; both modes capped at 1000 a run ----------
-- Same as 0054 apart from those two changes.
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
        and not x.pinned and not x.kept
      order by x.created_at, x.id
      limit 1000
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
        limit 1000
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

-- ---------- 2. orphans ----------
-- attachments-bucket files over a day old that nothing points at (up to 5000 a run), queued
-- under their own owner. Returns the files to remove now. Service role only.
create or replace function public.expire_orphans(run uuid)
returns table (bucket text, path text, bytes bigint) language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into public.cleanup_file_queue (path, owner_id, bytes)
    select o.name, o.owner_id::uuid, coalesce((o.metadata->>'size')::bigint, 0)
    from storage.objects o
    where o.bucket_id = 'attachments'
      and o.created_at < now() - interval '1 day'
      and o.owner_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and not exists (select 1 from public.cleanup_file_queue q where q.path = o.name)
      and not public.attachment_in_use(o.name)
    order by o.created_at
    limit 5000
    on conflict on constraint cleanup_file_queue_pkey do nothing;
  get diagnostics n = row_count;
  if n > 0 then
    update public.cleanup_runs r set steps = r.steps || 'orphans'::text where r.id = run;
  end if;
  return query select * from public.cleanup_pending_files();
end $$;
revoke execute on function public.expire_orphans(uuid) from public, anon, authenticated;
grant execute on function public.expire_orphans(uuid) to service_role;

alter table public.cleanup_runs drop constraint if exists cleanup_runs_steps_check;
alter table public.cleanup_runs add constraint cleanup_runs_steps_check
  check (steps <@ array['age', 'pressure', 'messages', 'orphans']::text[]);

-- ---------- 5. set_message_kept: read check before the lock ----------
-- Same as 0054, with can_read_message first. Errors: 'message not found', 'not permitted'.
create or replace function public.set_message_kept(msg uuid, keep boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.messages;
  srv uuid;
begin
  perform public.require_live_account();
  if not public.can_read_message(msg) then
    raise exception 'message not found';
  end if;
  select * into m from public.messages x where x.id = msg for update;
  if not found then
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

-- ---------- 6. a run that couldn't start is still on record ----------
create or replace function public.cleanup_record_failure(trigger text, actor uuid, error text)
returns uuid language sql security definer set search_path = public as $$
  insert into public.cleanup_runs (trigger, actor_id, finished_at, error)
    values (cleanup_record_failure.trigger, actor, now(), left(coalesce(cleanup_record_failure.error, 'could not start'), 2000))
    returning id;
$$;
revoke execute on function public.cleanup_record_failure(text, uuid, text) from public, anon, authenticated;
grant execute on function public.cleanup_record_failure(text, uuid, text) to service_role;
