insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('server-icons', 'server-icons', true, 2097152,
        array['image/png','image/jpeg','image/gif','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "authenticated upload server-icons" on storage.objects;
create policy "authenticated upload server-icons"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'server-icons');

drop policy if exists "public read server-icons" on storage.objects;
create policy "public read server-icons"
  on storage.objects for select to public
  using (bucket_id = 'server-icons');
