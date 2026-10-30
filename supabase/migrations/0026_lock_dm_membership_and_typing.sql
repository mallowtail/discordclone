-- 0026: lock DM membership inserts + Realtime Authorization for typing topics
--
-- 1. Security: 0001_init.sql created "add members to conversations" on
--    conversation_members with check (true), letting any signed-in user add
--    anyone (including themselves) to any DM. Likewise any authenticated user
--    could create bare conversations. DM creation now goes only through the
--    SECURITY DEFINER public.get_or_create_dm (0024), so both policies are dropped.
-- 2. Typing indicators use private Realtime broadcast channels. Topics
--    `typing-channel:<channel uuid>` and `typing-dm:<conversation uuid>` are
--    only readable/writable by members, enforced via policies on realtime.messages.

drop policy if exists "add members to conversations" on public.conversation_members;
drop policy if exists "authenticated create conversations" on public.conversations;

create or replace function public.can_access_typing_topic(topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Regex check precedes the uuid cast so malformed topics return false, not an error.
  if topic ~ '^typing-channel:[0-9a-f-]{36}$' then
    return public.is_channel_member(split_part(topic, ':', 2)::uuid);
  elsif topic ~ '^typing-dm:[0-9a-f-]{36}$' then
    return public.is_conversation_member(split_part(topic, ':', 2)::uuid);
  end if;
  return false;
exception when invalid_text_representation then
  return false;
end;
$$;

grant execute on function public.can_access_typing_topic(text) to authenticated;

drop policy if exists "typing receive" on realtime.messages;
create policy "typing receive" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and public.can_access_typing_topic((select realtime.topic()))
  );

drop policy if exists "typing send" on realtime.messages;
create policy "typing send" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and public.can_access_typing_topic((select realtime.topic()))
  );
