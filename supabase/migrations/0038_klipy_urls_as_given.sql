-- KLIPY's integration rules say media URLs must be used exactly as returned, query parameters
-- (tracking, delivery data) included, and loaded straight from KLIPY. 0036 only allowed bare
-- static.klipy.com paths; allow any KLIPY media host and an optional query string, still https and
-- still nothing but KLIPY.
alter table public.messages drop constraint messages_gif;
alter table public.messages add constraint messages_gif check (
  gif is null or (
    jsonb_typeof(gif) = 'object'
    and gif->>'url' ~ '^https://([a-z0-9-]+\.)*klipy\.com/[^\s"''<>\\]+$'
    and char_length(gif->>'url') <= 2000
    and jsonb_typeof(gif->'width') = 'number' and (gif->>'width')::numeric between 1 and 4000
    and jsonb_typeof(gif->'height') = 'number' and (gif->>'height')::numeric between 1 and 4000
    and char_length(coalesce(gif->>'title', '')) <= 200
  )
);
