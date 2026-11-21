-- 0051: leaving a server drops your roles in it.
-- Leaving is a plain delete of your server_members row (0005 "self leave server"), and member_roles has no
-- FK to server_members, so a leaver kept their roles. has_server_permission (0012) does not check
-- membership, so they kept e.g. manage_channels / manage_server / manage_server_icon in that server.
-- Kick and ban already delete member_roles (0018, 0041); this makes every removal path do it.
-- Re-deleting already-deleted rows (kick, ban, delete_server cascade, account deletion) is a harmless no-op.

create or replace function public.drop_roles_on_member_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.member_roles where server_id = old.server_id and user_id = old.user_id;
  return null;
end $$;
revoke execute on function public.drop_roles_on_member_delete() from public, anon, authenticated;

drop trigger if exists server_members_drop_roles on public.server_members;
create trigger server_members_drop_roles
  after delete on public.server_members
  for each row execute function public.drop_roles_on_member_delete();

-- One-off cleanup: role rows of people who are no longer members.
delete from public.member_roles mr
where not exists (
  select 1 from public.server_members m where m.server_id = mr.server_id and m.user_id = mr.user_id
);
