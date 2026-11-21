-- Let the app remove avatar and server-icon files (0004 and 0006 only allowed upload and read, so
-- `storage.remove()` silently removed nothing). Needed by account deletion (your avatar goes first)
-- and server deletion (its icon goes first), both from migration 0046.
--
-- avatars: you may delete files you uploaded (storage sets owner_id to the uploader's id).
-- server-icons: you may delete files you uploaded, or the icon a server currently uses when you
--   own that server or have manage_server in it (checked by a definer helper, so the server row is
--   found regardless of the caller's RLS view).

create or replace function public.can_remove_server_icon(obj_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.servers s
    where s.icon_url is not null
      and s.icon_url = 'https://dpsikhsxdwigeuyonfch.supabase.co/storage/v1/object/public/server-icons/' || obj_name
      and public.has_server_permission(s.id, 'manage_server')
  );
$$;
revoke execute on function public.can_remove_server_icon(text) from public, anon;
grant execute on function public.can_remove_server_icon(text) to authenticated;

drop policy if exists "owners delete avatars" on storage.objects;
create policy "owners delete avatars"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and owner_id = auth.uid()::text);

drop policy if exists "owners and managers delete server-icons" on storage.objects;
create policy "owners and managers delete server-icons"
  on storage.objects for delete to authenticated
  using (bucket_id = 'server-icons'
    and (owner_id = auth.uid()::text or public.can_remove_server_icon(name)));
