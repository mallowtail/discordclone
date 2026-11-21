-- 0045: sticker hardening (follow-up to 0044).
--
-- 1. Storage: the stickers bucket is public, so sticker files load by their public URL without
--    any select policy. 0044's "public read stickers" policy only added LISTING, which let anyone
--    with the anon key enumerate every server's sticker files. Replace it with a select policy for
--    people who manage that server's stickers (Supabase's storage remove needs select + delete).
-- 2. Nothing listens to realtime changes on public.stickers, and delete events would broadcast
--    sticker ids, so take the table out of the publication.
-- 3. sticker_folder_server gets a fixed search_path (same body as 0044).

drop policy if exists "public read stickers" on storage.objects;

drop policy if exists "managers read stickers" on storage.objects;
create policy "managers read stickers"
  on storage.objects for select to authenticated
  using (bucket_id = 'stickers'
    and public.has_server_permission(public.sticker_folder_server(name), 'manage_stickers'));

do $$
begin
  if exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stickers') then
    alter publication supabase_realtime drop table public.stickers;
  end if;
end $$;

-- The server a sticker file belongs to: the first folder of `<server_id>/<sticker_id>.<ext>`.
-- A path without a folder, or whose folder isn't a uuid, gives null (so the policy refuses it
-- instead of erroring).
create or replace function public.sticker_folder_server(object_name text)
returns uuid language plpgsql immutable
set search_path = public
as $$
declare
  folder text := split_part(coalesce(object_name, ''), '/', 1);
begin
  if position('/' in coalesce(object_name, '')) = 0
     or folder !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return null;
  end if;
  return folder::uuid;
end $$;
