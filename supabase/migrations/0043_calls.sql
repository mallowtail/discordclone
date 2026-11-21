-- DM / group calls: a record that a call is going on in a conversation, so the other members get an
-- incoming-call pop-up and a "Join call" button. The audio itself is LiveKit (room dm_<conversation>).
create table public.calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  started_by uuid references public.profiles(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index calls_active on public.calls (conversation_id) where ended_at is null;

alter table public.calls enable row level security;
create policy "members see their conversations' calls" on public.calls for select to authenticated
  using (public.is_conversation_member(conversation_id));
alter publication supabase_realtime add table public.calls;

-- Start a call (or return the one already going). 1:1 DMs honour blocks and DM settings, like
-- messages. A call left "going" for over 12 hours (everyone closed their tabs) is treated as over.
create or replace function public.start_call(conv uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare existing uuid; c uuid;
begin
  if not public.is_conversation_member(conv) then
    raise exception 'not a member';
  end if;
  if not public.dm_send_allowed(conv) then
    raise exception 'cannot call this person';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('call:' || conv::text, 0));
  update public.calls x set ended_at = now()
    where x.conversation_id = conv and x.ended_at is null and x.started_at < now() - interval '12 hours';
  select x.id into existing from public.calls x where x.conversation_id = conv and x.ended_at is null limit 1;
  if existing is not null then
    return existing;
  end if;
  insert into public.calls (conversation_id, started_by) values (conv, auth.uid()) returning id into c;
  return c;
end $$;
grant execute on function public.start_call(uuid) to authenticated;

-- Called by the last person to leave.
create or replace function public.end_call(conv uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_conversation_member(conv) then
    raise exception 'not a member';
  end if;
  update public.calls x set ended_at = now() where x.conversation_id = conv and x.ended_at is null;
end $$;
grant execute on function public.end_call(uuid) to authenticated;
