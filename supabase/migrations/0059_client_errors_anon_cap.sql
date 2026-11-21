-- 0059: error-log follow-ups (polish, 2026-11-22). Replaces log_client_error from 0057.
--
--  - Anonymous rows (user_id null: visitors not signed in, sessions without a profile) are capped
--    at 1,000 on their own, deleting the oldest anonymous ones, so a flood from logged-out pages
--    can't push signed-in people's errors out of the 5,000-row cap.
--  - Invite links are paths: /invite/<code> is stored as /invite/[code] (same as cleanPath in
--    src/lib/errors/report.ts).
-- Everything else (rate limits, scrubbing, dedupe, grants) is unchanged.

create index if not exists client_errors_anon_last_seen_idx
  on public.client_errors (last_seen desc, id desc) where user_id is null;

create or replace function public.log_client_error(
  p_message text,
  p_stack text default null,
  p_path text default null,
  p_user_agent text default null,
  p_kind text default 'error'
)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_msg text;
  v_stack text;
  v_path text;
  v_ua text;
  v_kind text := case when p_kind in ('error', 'rejection', 'boundary') then p_kind else 'error' end;
  v_existing bigint;
  v_profile uuid;
begin
  -- Rate limit first (before any real work); every call counts, repeats included.
  if v_uid is not null then
    if not public.client_error_hit('u:' || v_uid::text, interval '10 minutes', 20) then return 'limited'; end if;
  else
    if not public.client_error_hit('anon', interval '1 minute', 30) then return 'limited'; end if;
  end if;
  if not public.client_error_hit('all', interval '1 minute', 200) then return 'limited'; end if;

  -- Cut huge inputs before scrubbing (cheap regexes), scrub, then cut to the stored size.
  v_msg := btrim(left(public.scrub_error_text(left(coalesce(p_message, ''), 2000)), 500));
  if v_msg = '' then return 'ignored'; end if;
  v_stack := nullif(btrim(left(public.scrub_error_text(left(p_stack, 8000)), 4000)), '');
  -- Page path only: never the query string or hash.
  -- Invite codes are secrets of a kind (anyone holding one can join): /invite/<code> → /invite/[code].
  v_path := left(public.scrub_error_text(regexp_replace(
    split_part(split_part(left(coalesce(p_path, ''), 1000), '?', 1), '#', 1),
    '^/invite/[^/]+', '/invite/[code]')), 200);
  v_ua := nullif(btrim(left(public.scrub_error_text(left(p_user_agent, 600)), 300)), '');

  -- A session without a profile row yet (first OAuth sign-in) is stored without a user.
  select p.id into v_profile from public.profiles p where p.id = v_uid;

  -- Same message on the same page within the hour → one row with a count.
  perform pg_advisory_xact_lock(hashtext('client_errors:' || md5(v_msg || '|' || v_path)));
  select e.id into v_existing from public.client_errors e
   where md5(e.message || '|' || e.path) = md5(v_msg || '|' || v_path)
     and e.message = v_msg and e.path = v_path
     and e.last_seen > now() - interval '1 hour'
   order by e.last_seen desc limit 1;
  if v_existing is not null then
    update public.client_errors set
      count = least(count, 2147483646) + 1,
      last_seen = now(),
      stack = coalesce(v_stack, stack),
      user_agent = coalesce(v_ua, user_agent),
      user_id = coalesce(v_profile, user_id),
      kind = v_kind
    where id = v_existing;
    return 'counted';
  end if;

  insert into public.client_errors (message, stack, path, user_agent, kind, user_id)
  values (v_msg, v_stack, v_path, v_ua, v_kind, v_profile);
  -- Visitors who aren't signed in get at most 1,000 rows (oldest of theirs go first), so
  -- anonymous reports can never push signed-in people's errors out of the 5,000 total.
  if v_profile is null then
    delete from public.client_errors where id in (
      select id from public.client_errors where user_id is null
       order by last_seen desc, id desc offset 1000
    );
  end if;
  -- Keep the newest 5,000.
  delete from public.client_errors where id in (
    select id from public.client_errors order by last_seen desc, id desc offset 5000
  );
  return 'stored';
end $$;
revoke execute on function public.log_client_error(text, text, text, text, text) from public;
grant execute on function public.log_client_error(text, text, text, text, text) to anon, authenticated;
