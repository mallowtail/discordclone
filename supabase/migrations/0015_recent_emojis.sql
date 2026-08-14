-- Per-user most-recently-used reaction emojis (most-recent first), for the message toolbar.
alter table public.profiles
  add column if not exists recent_emojis text[] not null default '{}';

-- Atomically record an emoji as most-recent for the calling user: dedupe, unshift, cap at 12.
create or replace function public.push_recent_emoji(e text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set recent_emojis =
       (array[e] || array_remove(recent_emojis, e))[1:12]
   where id = auth.uid();
$$;

grant execute on function public.push_recent_emoji(text) to authenticated;
