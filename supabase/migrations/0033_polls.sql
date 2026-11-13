-- Polls. A poll is a message (so replies, reactions, pins, deleting and the spam limit all just
-- work) whose text is the question, plus a polls row and its answers. Results — who voted for what —
-- are only readable once you've voted or the poll has ended; before that you only get the total.
--
-- Posting: create_poll runs with the caller's rights, so the normal message rules (membership,
-- timeouts, spam limit) apply to the message it inserts. Voting and ending go through
-- security-definer functions; the vote and poll tables have no direct write policies.

alter table public.messages add column poll boolean not null default false;

create table public.polls (
  message_id uuid primary key references public.messages(id) on delete cascade,
  allow_multiple boolean not null default false,
  ends_at timestamptz not null
);

create table public.poll_options (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.polls(message_id) on delete cascade,
  position smallint not null check (position between 1 and 10),
  label text not null check (char_length(label) between 1 and 55),
  unique (message_id, position)
);

-- Keyed on an opaque id: Realtime sends deletes to every subscriber with only the primary key.
create table public.poll_votes (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.polls(message_id) on delete cascade,
  option_id uuid not null references public.poll_options(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (option_id, user_id)
);
create index poll_votes_message_user on public.poll_votes (message_id, user_id);

-- Has the caller voted on this poll, or has it ended? (Definer: the policy below can't query
-- poll_votes under its own RLS without recursing.)
create or replace function public.poll_results_visible(msg uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.poll_votes v where v.message_id = $1 and v.user_id = auth.uid())
      or exists (select 1 from public.polls p where p.message_id = $1 and p.ends_at <= now());
$$;
grant execute on function public.poll_results_visible(uuid) to authenticated;

alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;

create policy "read polls you can see" on public.polls for select to authenticated
  using (public.can_read_message(message_id));
create policy "read poll answers you can see" on public.poll_options for select to authenticated
  using (public.can_read_message(message_id));
create policy "read votes after voting or when ended" on public.poll_votes for select to authenticated
  using (public.can_read_message(message_id) and public.poll_results_visible(message_id));

-- Only create_poll's own inserts get through: the author, for a poll message posted moments ago,
-- before anyone has voted (so answers can't be swapped later).
create policy "author creates poll" on public.polls for insert to authenticated
  with check (exists (
    select 1 from public.messages m
    where m.id = message_id and m.author_id = auth.uid() and m.poll and m.created_at > now() - interval '1 minute'
  ));
create policy "author adds answers" on public.poll_options for insert to authenticated
  with check (
    exists (
      select 1 from public.messages m
      where m.id = message_id and m.author_id = auth.uid() and m.created_at > now() - interval '1 minute'
    )
    and not exists (select 1 from public.poll_votes v where v.message_id = poll_options.message_id)
  );

alter publication supabase_realtime add table public.polls, public.poll_votes;

-- Post a poll in a channel or a DM/group (exactly one target).
create or replace function public.create_poll(
  target_channel uuid,
  target_conversation uuid,
  question text,
  answers text[],
  duration_seconds integer,
  allow_multiple boolean
)
returns uuid language plpgsql set search_path = public as $$
declare
  msg uuid := gen_random_uuid();
  q text := btrim(public.strip_message_controls(coalesce(question, '')));
  cleaned text[];
  a text;
  i int := 0;
begin
  if char_length(q) not between 1 and 300 then
    raise exception 'invalid poll question';
  end if;
  if duration_seconds is null or duration_seconds not in (3600, 14400, 28800, 86400, 259200, 604800) then
    raise exception 'invalid poll duration';
  end if;
  select coalesce(array_agg(x order by ord), '{}') into cleaned
    from (select btrim(public.strip_invisible(t)) as x, ord from unnest(answers) with ordinality as u(t, ord)) s
    where x <> '';
  if cardinality(cleaned) not between 2 and 10 then
    raise exception 'a poll needs 2 to 10 answers';
  end if;
  if exists (select 1 from unnest(cleaned) as x where char_length(x) > 55) then
    raise exception 'poll answer too long';
  end if;
  insert into public.messages (id, author_id, channel_id, conversation_id, content, poll)
    values (msg, auth.uid(), target_channel, target_conversation, q, true);
  insert into public.polls (message_id, allow_multiple, ends_at)
    values (msg, coalesce(allow_multiple, false), now() + make_interval(secs => duration_seconds));
  foreach a in array cleaned loop
    i := i + 1;
    insert into public.poll_options (message_id, position, label) values (msg, i, a);
  end loop;
  return msg;
end $$;
grant execute on function public.create_poll(uuid, uuid, text, text[], integer, boolean) to authenticated;

-- Replace the caller's vote with `option_ids` (an empty array removes it).
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
end $$;
grant execute on function public.vote_poll(uuid, uuid[]) to authenticated;

-- The poll's author ends it early.
create or replace function public.end_poll(msg uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.polls p set ends_at = least(p.ends_at, now())
  where p.message_id = msg
    and exists (select 1 from public.messages m where m.id = msg and m.author_id = auth.uid());
  if not found then
    raise exception 'only the poll''s author can end it';
  end if;
end $$;
grant execute on function public.end_poll(uuid) to authenticated;

-- How many people have voted — shown before you vote, when the breakdown is still hidden.
create or replace function public.poll_voter_count(msg uuid)
returns integer language sql stable security definer set search_path = public as $$
  select case when public.can_read_message($1)
    then (select count(distinct v.user_id)::int from public.poll_votes v where v.message_id = $1)
    else 0 end;
$$;
grant execute on function public.poll_voter_count(uuid) to authenticated;

-- A poll's question can't be edited and a message can't be turned into (or out of) a poll.
-- Same as 0032's guard, plus the two poll rules.
create or replace function public.guard_message_update()
returns trigger language plpgsql as $$
begin
  if not public.is_direct_client() then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.author_id is distinct from old.author_id
     or new.channel_id is distinct from old.channel_id
     or new.conversation_id is distinct from old.conversation_id
     or new.created_at is distinct from old.created_at
     or new.image_url is distinct from old.image_url
     or new.file_url is distinct from old.file_url
     or new.file_name is distinct from old.file_name
     or new.reply_to_id is distinct from old.reply_to_id
     or new.mention_author is distinct from old.mention_author
     or new.pinned is distinct from old.pinned
     or new.pinned_at is distinct from old.pinned_at
     or new.forward_snapshot is distinct from old.forward_snapshot
     or new.poll is distinct from old.poll then
    raise exception 'only the message text can be edited';
  end if;
  if old.poll and new.content is distinct from old.content then
    raise exception 'polls can''t be edited';
  end if;
  new.content := public.strip_message_controls(new.content);
  new.updated_at := case when new.content is distinct from old.content then now() else old.updated_at end;
  return new;
end $$;
