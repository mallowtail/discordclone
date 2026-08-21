-- Block banned users from rejoining via an invite link. join_via_invite is SECURITY DEFINER
-- and bypasses RLS, so the is_banned() check on the "self join server" policy (0018) did not
-- cover the invite path — for private servers, invite is the only join path.
create or replace function public.join_via_invite(code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare srv uuid;
begin
  select id into srv from public.servers where invite_code = code;
  if srv is null then
    raise exception 'invalid invite code';
  end if;
  if public.is_banned(srv) then
    raise exception 'banned from this server';
  end if;
  insert into public.server_members (server_id, user_id, role)
    values (srv, auth.uid(), 'member')
    on conflict (server_id, user_id) do nothing;
  return srv;
end $$;
grant execute on function public.join_via_invite(text) to authenticated;
