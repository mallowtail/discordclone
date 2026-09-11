-- 0022_search_total_count.sql — return the total match count from search_messages so the
-- results panel can show numbered pagination (page 1..N) instead of a "load more" button.
-- Adding a column to the RETURNS TABLE changes the function's return type, which
-- `create or replace` can't do, so drop and recreate. `count(*) over()` counts every row
-- that passes WHERE (before limit/offset), i.e. the full match total, repeated on each row.

drop function if exists public.search_messages(
  uuid, text, text, text, text, timestamptz, timestamptz, text, boolean, int, int
);

create function public.search_messages(
  srv           uuid,
  text_query    text        default null,
  from_user     text        default null,
  in_channel    text        default null,
  has_type      text        default null,
  before_ts     timestamptz default null,
  after_ts      timestamptz default null,
  mentions_user text        default null,
  only_pinned   boolean     default false,
  lim           int         default 25,
  off_n         int         default 0
) returns table (
  id uuid, channel_id uuid, channel_name text,
  author_id uuid, author_username text, author_display_name text, author_avatar_url text,
  content text, image_url text, file_url text, file_name text,
  pinned boolean, created_at timestamptz,
  total_count int
)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.channel_id, c.name,
         m.author_id, p.username, p.display_name, p.avatar_url,
         m.content, m.image_url, m.file_url, m.file_name,
         m.pinned, m.created_at,
         count(*) over()::int as total_count
  from public.messages m
  join public.channels c on c.id = m.channel_id
  join public.profiles p on p.id = m.author_id
  where c.server_id = srv
    and public.is_server_member(srv)
    and (text_query is null or position(lower(text_query) in lower(coalesce(m.content, ''))) > 0)
    and (from_user is null or p.username = from_user)
    and (in_channel is null or c.name = in_channel)
    and (has_type is null
         or (has_type = 'link'  and m.content ~* 'https?://')
         or (has_type = 'image' and m.image_url is not null)
         or (has_type = 'file'  and m.file_url  is not null))
    and (before_ts is null or m.created_at <  before_ts)
    and (after_ts  is null or m.created_at >= after_ts)
    and (mentions_user is null
         or m.content ~* ('@' || regexp_replace(mentions_user, '([\\^$.|?*+()\[\]{}])', '\\\1', 'g') || '\y'))
    and (not only_pinned or m.pinned)
  order by m.created_at desc
  limit greatest(1, least(lim, 50)) offset greatest(0, off_n);
$$;

grant execute on function public.search_messages(
  uuid, text, text, text, text, timestamptz, timestamptz, text, boolean, int, int
) to authenticated;
