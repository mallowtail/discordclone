-- widen the "non-empty" check so a forwarded message (payload inside forward_snapshot) is allowed
alter table public.messages drop constraint if exists messages_nonempty;
alter table public.messages add constraint messages_nonempty
  check (char_length(content) > 0 or image_url is not null or file_url is not null or forward_snapshot is not null);
