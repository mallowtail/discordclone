-- 0020_message_search.sql — full-text search over server channel messages.

-- 1. Generated tsvector column + GIN index (auto-recomputes on content edit).
alter table public.messages
  add column if not exists content_tsv tsvector
  generated always as (to_tsvector('english', coalesce(content, ''))) stored;

create index if not exists messages_content_tsv_idx
  on public.messages using gin (content_tsv);

-- 2. Search RPC. SECURITY DEFINER so it can read across the server's channels, but it
--    first checks the caller is a member of the server (defence in depth atop RLS) and
--    only ever reads channels where c.server_id = srv.
create or replace function public.search_messages(
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
  pinned boolean, created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.channel_id, c.name,
         m.author_id, p.username, p.display_name, p.avatar_url,
         m.content, m.image_url, m.file_url, m.file_name,
         m.pinned, m.created_at
  from public.messages m
  join public.channels c on c.id = m.channel_id
  join public.profiles p on p.id = m.author_id
  where c.server_id = srv
    and public.is_server_member(srv)
    and (text_query is null or m.content_tsv @@ websearch_to_tsquery('english', text_query))
    and (from_user is null or p.username = from_user)
    and (in_channel is null or c.name = in_channel)
    and (has_type is null
         or (has_type = 'link'  and m.content ~* 'https?://')
         or (has_type = 'image' and m.image_url is not null)
         or (has_type = 'file'  and m.file_url  is not null))
    and (before_ts is null or m.created_at <  before_ts)
    and (after_ts  is null or m.created_at >= after_ts)
    and (mentions_user is null or m.content ~* ('@' || mentions_user || '\y'))
    and (not only_pinned or m.pinned)
  order by m.created_at desc
  limit greatest(1, least(lim, 50)) offset greatest(0, off_n);
$$;

grant execute on function public.search_messages(
  uuid, text, text, text, text, timestamptz, timestamptz, text, boolean, int, int
) to authenticated;
