-- 0056: free-plan limits — safety fixes after the final review (0054, 0055).
--
--  1. Open reports keep their evidence: a file that an open report's snapshot points at (its
--     picture/file, or those of the forwarded message inside it) counts as "in use", so no clean-up
--     rule removes it (30 days, 80% storage, database safety net, orphans). A message with an open
--     report also keeps its picture/file (30 days and 80% skip it). Once the report is handled, the
--     next run treats the file as usual (e.g. an orphan if its message was deleted).
--  2. (Edge Function) steps now run age → orphans → pressure → messages, so files nobody uses are
--     gone before the 80% rule decides how much it has to take from real messages.
--  3. Database safety net: deletes at most a quarter of the messages (by estimated size) per run,
--     and deletes nothing if messages are under 30% of the database — then the growth is from
--     something else, and the run records "needs a look" (shown on /admin).
--  4. A pinned or kept forwarded copy (or any pinned/kept message with the same file) keeps the
--     picture: the original isn't stripped while one points at its file.
--  5. 80% rule never takes pinned, kept, open-report (or item 4) messages; if storage is still
--     over 80% when only those are left, the run records it.
--  6. messages_deleted counts the rows actually deleted.
--  Notes like 3 and 5 go into cleanup_runs.error (added to, not replaced, by cleanup_finish).

-- ---------- limits ----------
-- The safety net only deletes messages if they are at least this share of the database.
create or replace function public.limit_messages_share()
returns numeric language sql immutable as $$ select 0.30::numeric $$;
grant execute on function public.limit_messages_share() to service_role;

-- Open message reports by message (the "has an open report" check).
create index if not exists reports_open_message on public.reports (message_id)
  where status = 'open' and kind = 'message';

-- ---------- 1. open reports count as "in use" ----------
-- Same as 0055, plus open reports' snapshots (and the forwarded message inside them).
create or replace function public.attachment_in_use(path text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.messages m where m.image_url = public.attachment_url(path))
      or exists (select 1 from public.messages m where m.file_url = public.attachment_url(path))
      or exists (select 1 from public.messages m where (m.forward_snapshot->>'image_url') = public.attachment_url(path))
      or exists (select 1 from public.messages m where (m.forward_snapshot->>'file_url') = public.attachment_url(path))
      or exists (select 1 from public.reports r
                 where r.status = 'open'
                   and public.attachment_url(path) in (r.snapshot->>'image_url', r.snapshot->>'file_url',
                                                       r.snapshot->'forward_snapshot'->>'image_url',
                                                       r.snapshot->'forward_snapshot'->>'file_url'));
$$;
revoke execute on function public.attachment_in_use(text) from public, anon, authenticated;

-- ---------- 1 + 4. messages whose picture/file the clean-up leaves alone ----------
-- Pinned, kept, with an open report, or its picture/file is also in a pinned or kept message
-- (e.g. a pinned forwarded copy). Internal.
create or replace function public.message_upload_protected(m public.messages)
returns boolean language sql stable security definer set search_path = public as $$
  select m.pinned or m.kept
      or exists (select 1 from public.reports r
                 where r.status = 'open' and r.kind = 'message' and r.message_id = m.id)
      or exists (select 1 from public.messages y
                 where (y.pinned or y.kept) and y.image_url in (m.image_url, m.file_url))
      or exists (select 1 from public.messages y
                 where (y.pinned or y.kept) and y.file_url in (m.image_url, m.file_url))
      or exists (select 1 from public.messages y
                 where (y.pinned or y.kept) and (y.forward_snapshot->>'image_url') in (m.image_url, m.file_url))
      or exists (select 1 from public.messages y
                 where (y.pinned or y.kept) and (y.forward_snapshot->>'file_url') in (m.image_url, m.file_url));
$$;
revoke execute on function public.message_upload_protected(public.messages) from public, anon, authenticated;

-- ---------- notes on a run ----------
-- Adds a line to the run's error (shown on /admin). Internal.
create or replace function public.cleanup_note(run uuid, note text)
returns void language sql security definer set search_path = public as $$
  update public.cleanup_runs r set error = left(concat_ws('; ', r.error, note), 2000) where r.id = run;
$$;
revoke execute on function public.cleanup_note(uuid, text) from public, anon, authenticated;

-- Same as 0054, but keeps notes the steps already wrote (the function's step errors are added).
create or replace function public.cleanup_finish(run uuid, error text default null)
returns void language sql security definer set search_path = public as $$
  update public.cleanup_runs r set finished_at = now(),
      error = left(nullif(concat_ws('; ', r.error, cleanup_finish.error), ''), 2000)
    where r.id = run;
$$;
revoke execute on function public.cleanup_finish(uuid, text) from public, anon, authenticated;
grant execute on function public.cleanup_finish(uuid, text) to service_role;

-- ---------- 1, 4, 5. 30 days / 80% skip protected messages; 80% stops when only they remain ----------
-- Same as 0055 apart from: both modes skip message_upload_protected; pressure no longer reaches
-- pinned/kept messages, and notes "storage still over 80%" if it couldn't get under.
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
        and not public.message_upload_protected(x)
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
        where (x.image_url is not null or x.file_url is not null)
          and not x.pinned and not x.kept
          and not public.message_upload_protected(x)
        order by x.created_at, x.id
        limit 1000
        for update skip locked
      loop
        exit when used < public.limit_storage_bytes() * 0.75;
        used := used - public.strip_message_upload(m, 'pressure');
        changed := changed + 1;
      end loop;
      if used >= public.limit_storage_bytes() * 0.80 then
        perform public.cleanup_note(run, 'storage still over 80% — what''s left is pinned, kept or reported (or not in messages)');
      end if;
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

-- ---------- 3, 6. database safety net: capped, only when messages are the growth ----------
-- Same as 0054 apart from: refuses (with a note) if messages are under limit_messages_share() of
-- the database; deletes at most a quarter of the messages' estimated size per run (notes when it
-- stopped there); messages_deleted is the DELETE's row count.
create or replace function public.expire_messages(run uuid)
returns table (bucket text, path text, bytes bigint) language plpgsql security definer set search_path = public as $$
declare
  size bigint := pg_database_size(current_database());
  last_size bigint;
  need bigint;
  total bigint;
  capped boolean := false;
  ids uuid[];
  m public.messages;
  f record;
  sz bigint;
  n integer := 0;
begin
  select r.database_bytes into last_size from public.cleanup_runs r
    where r.messages_deleted > 0 and r.id <> run
    order by r.started_at desc limit 1;
  if size >= public.limit_database_bytes() * 0.80
     and (last_size is null or size > last_size + 1024 * 1024) then
    if pg_total_relation_size('public.messages') < size * public.limit_messages_share() then
      perform public.cleanup_note(run, 'database is over 80% but the growth isn''t from messages — needs a look (no messages deleted)');
      return query select * from public.cleanup_pending_files();
      return;
    end if;
    need := size - (public.limit_database_bytes() * 0.75)::bigint;
    select coalesce(sum(pg_column_size(x.*)::bigint * 3 / 2), 0) into total from public.messages x;
    if need > total / 4 then
      need := total / 4;
      capped := true;
    end if;
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
      get diagnostics n = row_count;
      if n > 0 then
        update public.cleanup_runs r set
            messages_deleted = r.messages_deleted + n,
            database_bytes = size,
            steps = r.steps || 'messages'::text
          where r.id = run;
      end if;
    end if;
    if capped then
      perform public.cleanup_note(run, 'database safety net stopped at a quarter of the messages — the database is still over 80%, needs a look');
    end if;
  end if;
  return query select * from public.cleanup_pending_files();
end $$;
revoke execute on function public.expire_messages(uuid) from public, anon, authenticated;
grant execute on function public.expire_messages(uuid) to service_role;
