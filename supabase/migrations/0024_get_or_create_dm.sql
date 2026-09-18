-- 0024_get_or_create_dm.sql — atomic, race-safe "find or create the 1:1 DM" between the caller
-- and another user. Replaces the client-side find-then-create in src/lib/dm.ts, which could
-- create duplicate conversations when a user double-clicks "Message". A transaction-scoped
-- advisory lock keyed on the unordered user pair serializes concurrent creates, so at most one
-- 1:1 conversation ever exists for a pair. SECURITY DEFINER so it can create the membership rows;
-- it only ever acts between auth.uid() and `other`.

create or replace function public.get_or_create_dm(other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me   uuid := auth.uid();
  lo   uuid;
  hi   uuid;
  conv uuid;
begin
  if me is null or other is null or me = other then
    raise exception 'invalid dm target';
  end if;

  lo := least(me, other);
  hi := greatest(me, other);
  -- Serialize concurrent get_or_create for this unordered pair (lock released at commit).
  perform pg_advisory_xact_lock(hashtextextended(lo::text || ':' || hi::text, 0));

  -- Reuse an existing 1-on-1 (non-group) conversation the two of them already share.
  select c.id into conv
  from public.conversations c
  join public.conversation_members m_me    on m_me.conversation_id    = c.id and m_me.user_id    = me
  join public.conversation_members m_other on m_other.conversation_id = c.id and m_other.user_id = other
  where c.is_group = false
  limit 1;

  if conv is not null then
    return conv;
  end if;

  conv := gen_random_uuid();
  insert into public.conversations (id, is_group) values (conv, false);
  insert into public.conversation_members (conversation_id, user_id) values (conv, me), (conv, other);
  return conv;
end;
$$;

grant execute on function public.get_or_create_dm(uuid) to authenticated;
