alter table public.messages add column if not exists file_url text;
alter table public.messages add column if not exists file_name text;

-- widen the "non-empty" check to allow a file-only message
alter table public.messages drop constraint if exists messages_nonempty;
alter table public.messages add constraint messages_nonempty
  check (char_length(content) > 0 or image_url is not null or file_url is not null);
