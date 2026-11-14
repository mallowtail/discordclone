-- Forwarding a GIF message: include the GIF in the server-rebuilt snapshot (same as 0032's guard,
-- plus 'gif'). The snapshot's GIF can only ever come from the real message, so it's already vetted.
create or replace function public.guard_message_insert()
returns trigger language plpgsql set search_path = public as $$
declare
  src public.messages;
  src_id uuid;
begin
  if not public.is_direct_client() then
    return new;
  end if;

  -- 7. spam limit
  if public.recent_message_count() >= 5 then
    raise exception 'slow down: too many messages' using hint = 'rate_limited';
  end if;

  new.content := public.strip_message_controls(new.content);
  -- Server-controlled fields: a new message is never pre-pinned, edited, or backdated.
  new.created_at := now();
  new.updated_at := null;
  new.pinned := false;
  new.pinned_at := null;

  -- 2. forwards: the client names the message; the snapshot is rebuilt from it here.
  if new.forward_snapshot is not null then
    begin
      src_id := (new.forward_snapshot->>'message_id')::uuid;
    exception when invalid_text_representation then
      src_id := null;
    end;
    if src_id is null or not public.can_read_message(src_id) then
      raise exception 'cannot forward that message';
    end if;
    select * into src from public.messages m where m.id = src_id;
    new.forward_snapshot := jsonb_build_object(
      'message_id', src.id,
      'author_id', src.author_id,
      'content', coalesce(src.content, ''),
      'image_url', src.image_url,
      'file_url', src.file_url,
      'file_name', src.file_name,
      'gif', src.gif,
      'source', case
        when src.channel_id is not null then coalesce('#' || (select c.name from public.channels c where c.id = src.channel_id), 'a channel')
        else 'a direct message'
      end
    );
  end if;
  return new;
end $$;
