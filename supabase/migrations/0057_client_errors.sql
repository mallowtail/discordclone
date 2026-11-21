-- 0057: built-in error log (polish, 2026-11-22).
--
-- Errors in people's browsers (uncaught errors, unhandled promise rejections, React error
-- boundaries) are saved here and shown to the site admin on /admin → Errors.
--
--  1. client_errors: one row per distinct error (message + page path) per hour; repeats within the
--     hour bump `count` and `last_seen`. Capped at the newest 5,000 rows. Only the site admin can
--     read it (RLS); nobody writes it directly — only through log_client_error.
--  2. client_error_rate: fixed-window counters for the rate limit (no access for anyone).
--  3. scrub_error_text: blanks out anything that looks like a token, email, URL query or hash
--     parameter, a "password=…"-style value, or a long quoted string (could be someone's text).
--  4. log_client_error(message, stack, path, user_agent, kind): callable by signed-in people AND
--     anonymous visitors (errors on /login matter). Truncates (message 500, stack 4000, path 200,
--     user agent 300 characters) after scrubbing; rate-limited — 20 per signed-in person per 10
--     minutes, 30 per minute for all anonymous visitors together, 200 per minute for everyone
--     together. Over the limit it quietly does nothing (returns 'limited') so a browser stuck in an
--     error loop can't fill the database. Returns 'stored' | 'counted' | 'limited' | 'ignored'.
--  5. admin_clear_errors(): the site admin's "Clear" (returns how many rows went).

-- ---------- 1. the log ----------
create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  message text not null check (char_length(message) between 1 and 500),
  stack text check (stack is null or char_length(stack) <= 4000),
  path text not null default '' check (char_length(path) <= 200),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  kind text not null default 'error' check (kind in ('error', 'rejection', 'boundary')),
  -- The most recent signed-in person who hit it (helps reproduce); shown only on /admin.
  user_id uuid references public.profiles(id) on delete set null,
  count integer not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index if not exists client_errors_dedupe_idx
  on public.client_errors (md5(message || '|' || path), last_seen desc);
create index if not exists client_errors_last_seen_idx on public.client_errors (last_seen desc, id desc);
create index if not exists client_errors_user_idx on public.client_errors (user_id) where user_id is not null;

alter table public.client_errors enable row level security;
revoke all on table public.client_errors from public, anon, authenticated;
grant select on table public.client_errors to authenticated;
drop policy if exists "site admin reads client errors" on public.client_errors;
create policy "site admin reads client errors" on public.client_errors
  for select to authenticated using (public.is_site_admin());

-- ---------- 2. rate-limit counters ----------
create table if not exists public.client_error_rate (
  bucket text primary key,
  window_start timestamptz not null,
  n integer not null
);
alter table public.client_error_rate enable row level security;
revoke all on table public.client_error_rate from public, anon, authenticated;

-- ---------- 3. scrubbing ----------
-- The browser scrubs the same way first (src/lib/errors/report.ts); this is the one that counts.
create or replace function public.scrub_error_text(t text)
returns text language plpgsql immutable set search_path = public as $$
begin
  if t is null then return null; end if;
  -- JWTs (Supabase access tokens), also cut-off ones
  t := regexp_replace(t, 'eyJ[A-Za-z0-9_-]{8,}(\.[A-Za-z0-9_-]*){0,2}', '[token]', 'g');
  -- emails
  t := regexp_replace(t, '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+', '[email]', 'g');
  -- "Bearer abc…" / "Basic abc…"
  t := regexp_replace(t, '(bearer|basic)\s+[^\s"'',;]+', '\1 [token]', 'gi');
  -- password=…, "token": "…", apikey: …
  t := regexp_replace(t,
    '(access_token|refresh_token|token|secret|password|passwd|api[_-]?key|apikey|authorization)(["'']?\s*[:=]\s*["'']?)[^\s"'',;&)]+',
    '\1\2[redacted]', 'gi');
  -- URL query strings and hash parameters
  t := regexp_replace(t, '\?[^\s"''<>)\]]+', '?[query]', 'g');
  t := regexp_replace(t, '#[^\s"''<>)\]]*=[^\s"''<>)\]]*', '#[hash]', 'g');
  -- long random-looking strings (keys, tokens); a UUID (36) is left alone
  t := regexp_replace(t, '[A-Za-z0-9_+/=-]{40,}', '[token]', 'g');
  -- long quoted strings could be someone's message text
  t := regexp_replace(t, '"[^"]{60,}"', '"[text]"', 'g');
  t := regexp_replace(t, '''[^'']{60,}''', '''[text]''', 'g');
  return t;
end $$;
revoke execute on function public.scrub_error_text(text) from public, anon, authenticated;

-- ---------- 4. logging ----------
create or replace function public.client_error_hit(v_bucket text, v_window interval, v_cap integer)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare v_n integer;
begin
  insert into public.client_error_rate as r (bucket, window_start, n) values (v_bucket, now(), 1)
  on conflict (bucket) do update set
    window_start = case when r.window_start <= now() - v_window then now() else r.window_start end,
    n = case when r.window_start <= now() - v_window then 1 else r.n + 1 end
  returning r.n into v_n;
  return v_n <= v_cap;
end $$;
revoke execute on function public.client_error_hit(text, interval, integer) from public, anon, authenticated;

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
  v_path := left(public.scrub_error_text(split_part(split_part(left(coalesce(p_path, ''), 1000), '?', 1), '#', 1)), 200);
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
  -- Keep the newest 5,000.
  delete from public.client_errors where id in (
    select id from public.client_errors order by last_seen desc, id desc offset 5000
  );
  return 'stored';
end $$;
revoke execute on function public.log_client_error(text, text, text, text, text) from public;
grant execute on function public.log_client_error(text, text, text, text, text) to anon, authenticated;

-- ---------- 5. clear ----------
-- Error: 'not permitted'.
create or replace function public.admin_clear_errors()
returns integer language plpgsql volatile security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.is_site_admin() then
    raise exception 'not permitted';
  end if;
  delete from public.client_errors where true;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.admin_clear_errors() from public, anon;
grant execute on function public.admin_clear_errors() to authenticated;
