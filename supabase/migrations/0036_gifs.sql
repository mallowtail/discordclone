-- GIF messages (KLIPY). A GIF message stores which KLIPY file to show; the app displays it through
-- its own relay, so viewers' browsers never contact KLIPY (which would see their IP addresses).
-- Only KLIPY's media host is allowed, with sane dimensions and title length.
alter table public.messages add column gif jsonb;

alter table public.messages add constraint messages_gif check (
  gif is null or (
    jsonb_typeof(gif) = 'object'
    and gif->>'url' ~ '^https://static\.klipy\.com/[A-Za-z0-9/_-]+\.(webp|gif|jpg)$'
    and jsonb_typeof(gif->'width') = 'number' and (gif->>'width')::numeric between 1 and 4000
    and jsonb_typeof(gif->'height') = 'number' and (gif->>'height')::numeric between 1 and 4000
    and char_length(coalesce(gif->>'title', '')) <= 200
  )
);

-- A message with just a GIF (no text) is fine.
alter table public.messages drop constraint messages_nonempty;
alter table public.messages add constraint messages_nonempty check (
  char_length(content) > 0 or image_url is not null or file_url is not null or forward_snapshot is not null or gif is not null
);

-- Same as 0033's guard, plus: a GIF can't be swapped by editing.
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
     or new.poll is distinct from old.poll
     or new.gif is distinct from old.gif then
    raise exception 'only the message text can be edited';
  end if;
  if old.poll and new.content is distinct from old.content then
    raise exception 'polls can''t be edited';
  end if;
  new.content := public.strip_message_controls(new.content);
  new.updated_at := case when new.content is distinct from old.content then now() else old.updated_at end;
  return new;
end $$;
