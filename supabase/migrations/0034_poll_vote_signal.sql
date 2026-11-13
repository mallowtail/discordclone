-- Live vote counts for people who haven't voted yet. They can't read poll_votes (results stay hidden
-- until you vote), so Realtime never tells them a vote happened. Each vote now also touches the
-- poll row, which everyone in the conversation can read, and the app listens for that instead.
alter table public.polls add column updated_at timestamptz not null default now();

create or replace function public.vote_poll(msg uuid, option_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  p public.polls;
  picked uuid[];
begin
  if not public.can_read_message(msg) then
    raise exception 'not authorized';
  end if;
  if public.is_timed_out_message(msg) then
    raise exception 'you are timed out';
  end if;
  select * into p from public.polls where message_id = msg;
  if not found then
    raise exception 'not a poll';
  end if;
  if p.ends_at <= now() then
    raise exception 'poll has ended';
  end if;
  select coalesce(array_agg(distinct x), '{}') into picked from unnest(option_ids) as x where x is not null;
  if exists (
    select 1 from unnest(picked) as x
    where not exists (select 1 from public.poll_options o where o.id = x and o.message_id = msg)
  ) then
    raise exception 'invalid poll answer';
  end if;
  if not p.allow_multiple and cardinality(picked) > 1 then
    raise exception 'this poll allows one answer';
  end if;
  delete from public.poll_votes v where v.message_id = msg and v.user_id = auth.uid();
  insert into public.poll_votes (message_id, option_id, user_id) select msg, x, auth.uid() from unnest(picked) as x;
  update public.polls set updated_at = now() where message_id = msg;
end $$;
