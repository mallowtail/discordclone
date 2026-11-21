-- 0058: error-log scrubbing fixes (polish, 2026-11-22). Replaces scrub_error_text from 0057.
--
--  - The "long random string" rule no longer counts "/", so page paths like
--    /channels/<uuid> (46 characters) stay readable instead of becoming "[token]".
--    Keys and tokens without slashes (JWT parts, hex, base64url) are still blanked.
--  - URL queries and hash parameters are blanked BEFORE the "password=…" rule, so
--    "#access_token=…&x=1" becomes "#[hash]" whole (it used to leave "]&x=1" behind).
-- Same rules and order as scrubErrorText in src/lib/errors/report.ts.

create or replace function public.scrub_error_text(t text)
returns text language plpgsql immutable set search_path = public as $$
begin
  if t is null then return null; end if;
  -- JWTs (Supabase access tokens), also cut-off ones
  t := regexp_replace(t, 'eyJ[A-Za-z0-9_-]{8,}(\.[A-Za-z0-9_-]*){0,2}', '[token]', 'g');
  -- emails
  t := regexp_replace(t, '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+', '[email]', 'g');
  -- URL query strings and hash parameters
  t := regexp_replace(t, '\?[^\s"''<>)]+', '?[query]', 'g');
  t := regexp_replace(t, '#[^\s"''<>)]*=[^\s"''<>)]*', '#[hash]', 'g');
  -- "Bearer abc…" / "Basic abc…"
  t := regexp_replace(t, '(bearer|basic)\s+[^\s"'',;]+', '\1 [token]', 'gi');
  -- password=…, "token": "…", apikey: …
  t := regexp_replace(t,
    '(access_token|refresh_token|token|secret|password|passwd|api[_-]?key|apikey|authorization)(["'']?\s*[:=]\s*["'']?)[^\s"'',;&)]+',
    '\1\2[redacted]', 'gi');
  -- long random-looking strings (keys, tokens); a UUID (36) and paths are left alone
  t := regexp_replace(t, '[A-Za-z0-9_+=-]{40,}', '[token]', 'g');
  -- long quoted strings could be someone's message text
  t := regexp_replace(t, '"[^"]{60,}"', '"[text]"', 'g');
  t := regexp_replace(t, '''[^'']{60,}''', '''[text]''', 'g');
  return t;
end $$;
revoke execute on function public.scrub_error_text(text) from public, anon, authenticated;
