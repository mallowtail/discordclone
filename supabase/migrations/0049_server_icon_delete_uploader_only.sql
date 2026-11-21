-- Fix for 0048: the server-icons delete rule also allowed anyone with manage_server in a server
-- whose icon_url named the file. A manager can set their own server's icon_url to ANOTHER server's
-- icon file (the URL check only looks at the bucket and the name's shape), and could then delete
-- that file. Now only the uploader may delete a server-icon file. An icon uploaded by a different
-- admin stays in storage after its server is deleted (accepted).

drop policy if exists "owners and managers delete server-icons" on storage.objects;
drop policy if exists "uploaders delete server-icons" on storage.objects;
create policy "uploaders delete server-icons"
  on storage.objects for delete to authenticated
  using (bucket_id = 'server-icons' and owner_id = auth.uid()::text);

drop function if exists public.can_remove_server_icon(text);
