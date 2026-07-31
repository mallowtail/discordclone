# Custom roles — D2 RLS cutover + retire the tier — design

**Date:** 2026-07-31
**Sub-project:** Full custom roles. Slice **D2** of 4 (D1 foundation ✅ → **D2 cutover** →
D3 management UI → D4 display).
**Status:** approved, ready for planning

## Goal

Make **roles the only permission system.** Cut every management RLS policy from
`is_server_admin` over to `has_server_permission(..., '<perm>')`, and fully retire the
owner/admin/member tier: no seeded "Admin" role, no "Make admin" button. Owner stays a
hardcoded super-user; everyone else has power only through roles (assigned via D3's UI).

## Decisions (from brainstorming)

- **Kill the admin/member tier entirely.** Remove the seeded Admin roles, stop seeding, drop
  the tier-management policy + the "Make/Remove admin" UI. `server_members.role` stays as a
  physical column (joins still default to `member`) but nothing reads it for permissions.
- **Owner = super-user** (hardcoded via `servers.owner_id` inside `has_server_permission`).
- **Interim gating is owner-only:** until D3 lets the owner create + assign roles, only the
  owner sees management UI and passes RLS. Accepted explicitly — the user owns every server,
  so no one loses needed access (no non-owner admins exist).
- Colored **role badges** come in D4; for now the only badge is **OWNER**.

## Every `is_server_admin` site → new gate

| File / object | Policy | New gate |
|---|---|---|
| channels (0007) | insert/update/delete | `has_server_permission(server_id,'manage_channels')` |
| categories (0007) | insert/update/delete | `has_server_permission(server_id,'manage_channels')` |
| servers (0007) | update | `has_server_permission(id,'manage_server')` |
| roles (0012) | insert/update/delete | `has_server_permission(server_id,'manage_roles')` |
| member_roles (0012) | insert/delete | `has_server_permission(server_id,'manage_roles')` |
| `regenerate_invite()` (0008) body | `is_server_admin` guard | `has_server_permission(srv,'manage_server')` |
| server_members (0007) | "manage member roles" UPDATE | **DROPPED** (tier retired) |

`is_server_admin(uuid)` is left defined but becomes **unused dead code** after this (not
dropped in the dangerous slice to avoid dependency risk; a later cleanup removes it).

## Migration — `supabase/migrations/0013_roles_cutover.sql`

```sql
-- ===== 1. remove the seeded Admin roles (assignments cascade) =====
delete from public.roles
where name = 'Admin'
  and permissions @> array['manage_channels','manage_server','manage_roles','kick_members','manage_messages']::text[]
  and permissions <@ array['manage_channels','manage_server','manage_roles','kick_members','manage_messages']::text[];

-- ===== 2. channels: manage_channels =====
drop policy if exists "admins insert channels" on public.channels;
drop policy if exists "admins update channels" on public.channels;
drop policy if exists "admins delete channels" on public.channels;
create policy "insert channels" on public.channels for insert to authenticated with check (public.has_server_permission(server_id, 'manage_channels'));
create policy "update channels" on public.channels for update to authenticated using (public.has_server_permission(server_id, 'manage_channels'));
create policy "delete channels" on public.channels for delete to authenticated using (public.has_server_permission(server_id, 'manage_channels'));

-- ===== 3. categories: manage_channels =====
drop policy if exists "admins insert categories" on public.categories;
drop policy if exists "admins update categories" on public.categories;
drop policy if exists "admins delete categories" on public.categories;
create policy "insert categories" on public.categories for insert to authenticated with check (public.has_server_permission(server_id, 'manage_channels'));
create policy "update categories" on public.categories for update to authenticated using (public.has_server_permission(server_id, 'manage_channels'));
create policy "delete categories" on public.categories for delete to authenticated using (public.has_server_permission(server_id, 'manage_channels'));

-- ===== 4. servers: manage_server =====
drop policy if exists "admins update server" on public.servers;
create policy "update server" on public.servers for update to authenticated using (public.has_server_permission(id, 'manage_server'));

-- ===== 5. roles: manage_roles (replaces the D1 is_server_admin stand-in) =====
drop policy if exists "admins insert roles" on public.roles;
drop policy if exists "admins update roles" on public.roles;
drop policy if exists "admins delete roles" on public.roles;
create policy "insert roles" on public.roles for insert to authenticated with check (public.has_server_permission(server_id, 'manage_roles'));
create policy "update roles" on public.roles for update to authenticated using (public.has_server_permission(server_id, 'manage_roles'));
create policy "delete roles" on public.roles for delete to authenticated using (public.has_server_permission(server_id, 'manage_roles'));

-- ===== 6. member_roles: manage_roles =====
drop policy if exists "admins insert member_roles" on public.member_roles;
drop policy if exists "admins delete member_roles" on public.member_roles;
create policy "insert member_roles" on public.member_roles for insert to authenticated with check (public.has_server_permission(server_id, 'manage_roles'));
create policy "delete member_roles" on public.member_roles for delete to authenticated using (public.has_server_permission(server_id, 'manage_roles'));

-- ===== 7. drop the tier-management policy (server_members.role no longer grants anything) =====
drop policy if exists "manage member roles" on public.server_members;

-- ===== 8. regenerate_invite now needs manage_server =====
create or replace function public.regenerate_invite(srv uuid)
returns text language plpgsql security definer set search_path = public as $$
declare code text;
begin
  if not public.has_server_permission(srv, 'manage_server') then
    raise exception 'not authorized';
  end if;
  code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  update public.servers set invite_code = code where id = srv;
  return code;
end $$;
grant execute on function public.regenerate_invite(uuid) to authenticated;
```

Also **strip the seed block out of `supabase/migrations/0012_roles_foundation.sql`** (the
trailing `do $$ ... end $$;` that created the Admin roles) so a fresh setup never seeds. The
live DB is cleaned by step 1 above; editing 0012 only affects future/fresh applies (the live
DB won't re-run 0012).

**Rollback note:** to revert, re-point each policy back to `is_server_admin(...)` and restore
the "manage member roles" policy + the `regenerate_invite` `is_server_admin` guard.

## Client changes (retire the tier UI)

1. **`src/hooks/useServerRole.ts`** — gating becomes owner-only. Stop reading
   `server_members.role`; `isManager` = `isOwner`. Simplify the return to
   `{ isOwner: boolean; isManager: boolean; loading: boolean }` (drop `role`). Remove the
   `canManageRole` import.
2. **`src/lib/roles.ts` + `tests/roles.test.ts`** — DELETE both (the `canManageRole` tier
   helper is now unused). (Test count drops by its 3 tests.)
3. **`src/components/servers/MembersPanel.tsx`** — remove `setRole` and the "Make admin /
   Remove admin" buttons entirely. Simplify the badge to: owner → `OWNER`, otherwise no badge
   (drop the ADMIN/member distinction). It already fetches `ownerId`. `isManager` from
   `useServerRole` is no longer needed for the removed buttons; keep the panel otherwise
   unchanged (avatar → profile popover still works).
4. **`src/components/user/ProfileCard.tsx`** — the role resolution currently sets
   `OWNER`/`ADMIN`/`member` from `server_members.role`. Change `RoleLabel` to `"OWNER" | null`
   and set it only when `servers.owner_id === userId` (drop the `server_members.role` fetch
   and the ADMIN/member branches + their badge spans). Keep everything else.
5. **`src/components/servers/ServerSidebar.tsx`** — no change needed beyond what
   `useServerRole` already drives (`isManager` now = owner-only), which continues to gate
   +Channel/+Category and the settings dialog. Confirm it still compiles with the hook's
   trimmed return shape.

D3 will reintroduce permission-aware gating (per-`manage_x`) and the role create/assign UI;
D4 adds colored role badges.

## Non-goals (YAGNI / later slices)

- No role management or assignment UI (**D3**).
- No permission-aware client gating yet — owner-only interim (**D3** makes it granular).
- No colored role badges (**D4**).
- Not dropping `is_server_admin` or the `server_members.role` column (later cleanup).
- Not modifying `create_server` (D3 handles new-server role setup).

## Testing

- **Unit:** removing `tests/roles.test.ts` drops 3 tests; the rest of the suite stays green.
  No new unit surface (this slice is RLS + UI wiring).
- **Backend smoke** (live DB, throwaway users + server) — the critical gate:
  1. **Owner** can create a channel, create a category, rename the server, create a role,
     assign a role, and regenerate the invite — all succeed.
  2. A **no-role member** is blocked on every one of those (channel/category insert, server
     update, role insert, member_roles insert, `regenerate_invite` raises).
  3. Give a member a role with only **`manage_channels`** → they can create a channel but
     **cannot** rename the server, create a role, or regenerate the invite.
  4. Give a member **`manage_server`** → server rename + `regenerate_invite` succeed, but
     channel-create still fails (no `manage_channels`).
  5. Give a member **`manage_roles`** → they can create a role and assign it, but can't
     create a channel or rename the server.
  6. Confirm the **seeded Admin roles are gone**: query `roles` for the throwaway server shows
     no auto-created Admin (only roles the test explicitly makes).
- `npm run build` clean; full `npx vitest run` green (minus the deleted roles tests).

## Operational note

Run `0013_roles_cutover.sql` in the Supabase SQL editor. **This is the access-control
cutover** — after it, permissions come only from roles (owner always has all). Because no
non-owner currently holds any role, only owners can manage servers until D3 assigns roles.
