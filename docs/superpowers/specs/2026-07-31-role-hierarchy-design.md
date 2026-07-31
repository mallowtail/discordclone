# Custom roles — D3a role hierarchy in RLS — design

**Date:** 2026-07-31
**Sub-project:** Full custom roles. Slice **D3a** of 5 (D1 foundation ✅ → D2 cutover ✅ →
**D3a hierarchy RLS** → D3b management UI → D4 display).
**Status:** approved, ready for planning

## Goal

Enforce **role hierarchy** in the database so a non-owner with `manage_roles` cannot escalate
past their own rank: they can't create/move a role at or above their highest role, can't grant
a permission they don't hold, and can't assign a role above their rank. Owner is a hardcoded
super-user that bypasses all of it. **Backend + RLS only — no UI** (that's D3b).

## Decisions (from brainstorming)

- **`position` = rank.** Higher `position` = more senior. Owner is above every role.
- A caller's **rank** = the highest `position` among the roles they hold (none → no rank).
- **can't create/move a role at or above your rank** (strictly-below required).
- **can't grant permissions you don't hold** (a role's `permissions` must be a subset of yours
  when you create or edit it).
- **can't assign a role at or above your rank** (assignment needs `manage_roles` + the role
  strictly below your rank; assignment does NOT additionally require you to hold that role's
  permissions — matches Discord).
- **Owner bypasses everything.**

## Current state (what this revises)

D2 (`0013`) gave `roles` insert/update/delete and `member_roles` insert/delete flat
`has_server_permission(..., 'manage_roles')` policies. D3a replaces those five policies with
hierarchy-aware ones. The SELECT policies ("members read roles" / "members read member_roles"
from D1) are unchanged. `roles.position` already exists (default 0).

## Migration — `supabase/migrations/0014_role_hierarchy.sql`

```sql
-- ===== helper functions (SECURITY DEFINER: read roles/member_roles without RLS recursion) =====

-- caller's highest role position in a server (NULL if they hold no roles)
create or replace function public.my_role_rank(srv uuid)
returns int language sql security definer set search_path = public stable as $$
  select max(r.position)
  from public.member_roles mr
  join public.roles r on r.id = mr.role_id
  where mr.server_id = srv and mr.user_id = auth.uid();
$$;
grant execute on function public.my_role_rank(uuid) to authenticated;

-- caller's effective permissions (owner → all five; else the union of their roles')
create or replace function public.my_permissions(srv uuid)
returns text[] language sql security definer set search_path = public stable as $$
  select case
    when exists (select 1 from public.servers s where s.id = srv and s.owner_id = auth.uid())
      then array['manage_channels','manage_server','manage_roles','kick_members','manage_messages']::text[]
    else coalesce((
      select array_agg(distinct p)
      from public.member_roles mr
      join public.roles r on r.id = mr.role_id
      cross join lateral unnest(r.permissions) as p
      where mr.server_id = srv and mr.user_id = auth.uid()
    ), array[]::text[])
  end;
$$;
grant execute on function public.my_permissions(uuid) to authenticated;

-- can the caller create/edit/delete a role AT target_position WITH target_perms?
-- owner bypass; else manage_roles + strictly below rank + perms subset of caller's.
create or replace function public.can_manage_role(srv uuid, target_position int, target_perms text[])
returns boolean language sql security definer set search_path = public stable as $$
  select
    exists (select 1 from public.servers s where s.id = srv and s.owner_id = auth.uid())
    or (
      'manage_roles' = any(public.my_permissions(srv))
      and public.my_role_rank(srv) is not null
      and target_position < public.my_role_rank(srv)
      and target_perms <@ public.my_permissions(srv)
    );
$$;
grant execute on function public.can_manage_role(uuid, int, text[]) to authenticated;

-- can the caller assign/unassign a given role? owner bypass; else manage_roles + role below rank.
create or replace function public.can_assign_role(srv uuid, rid uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select
    exists (select 1 from public.servers s where s.id = srv and s.owner_id = auth.uid())
    or (
      'manage_roles' = any(public.my_permissions(srv))
      and public.my_role_rank(srv) is not null
      and exists (
        select 1 from public.roles r
        where r.id = rid and r.server_id = srv and r.position < public.my_role_rank(srv)
      )
    );
$$;
grant execute on function public.can_assign_role(uuid, uuid) to authenticated;

-- ===== roles: hierarchy-aware management (replaces D2's flat manage_roles policies) =====
drop policy if exists "insert roles" on public.roles;
drop policy if exists "update roles" on public.roles;
drop policy if exists "delete roles" on public.roles;
create policy "insert roles" on public.roles for insert to authenticated
  with check (public.can_manage_role(server_id, position, permissions));
create policy "update roles" on public.roles for update to authenticated
  using (public.can_manage_role(server_id, position, permissions))
  with check (public.can_manage_role(server_id, position, permissions));
create policy "delete roles" on public.roles for delete to authenticated
  using (public.can_manage_role(server_id, position, permissions));

-- ===== member_roles: hierarchy-aware assignment =====
drop policy if exists "insert member_roles" on public.member_roles;
drop policy if exists "delete member_roles" on public.member_roles;
create policy "insert member_roles" on public.member_roles for insert to authenticated
  with check (public.can_assign_role(server_id, role_id));
create policy "delete member_roles" on public.member_roles for delete to authenticated
  using (public.can_assign_role(server_id, role_id));
```

### Semantics notes
- **Owner** → first `exists(... owner_id = auth.uid())` branch is true everywhere; unrestricted.
- **Editing your own highest role** is blocked: its `position` equals your rank, and
  `position < my_role_rank` is false, so the UPDATE `using` clause denies it.
- **Moving a role up** to/above your rank is blocked by the UPDATE `with check`.
- **Granting perms you lack** is blocked by `target_perms <@ my_permissions` on insert/update.
- No RLS recursion: the helpers are `SECURITY DEFINER`, so reading `roles`/`member_roles`
  inside them bypasses those tables' RLS (same pattern as `is_server_member`).

## Known limitations (accepted for a small server; may refine in D3b)

- The UPDATE `with check` requires the **whole** new permission set to be a subset of yours,
  so a non-owner manager editing even the name/color of a below-them role that holds a
  permission they lack is blocked. Owner can always edit it. Documented, not fixed here.
- **Assignment** of a pre-existing below-you role does not require you to hold that role's
  permissions (Discord-standard). Only owner-created roles could carry perms above a given
  manager, and they'd still be below that manager's rank to be assignable.

## Non-goals (later slices)

- No role management/assignment UI, no permission-aware client gating (**D3b**).
- No colored names/badges (**D4**).
- No `@everyone` baseline role, no per-channel permission overrides.
- No auto-repositioning/compaction of `position` values (D3b's UI decides how positions are
  chosen when creating roles).

## Testing

No unit surface (pure SQL). The gate is a **heavy backend smoke** (live DB, throwaway users +
server). Setup: owner creates the server; owner creates role **High** (position 10, perms
`[manage_roles, manage_channels]`) and assigns it to **Alice**; owner creates a low role at
position 3.

1. **Owner** can create a role at any position with any perms; can move/edit/delete any role;
   can assign any role. (bypass)
2. **Alice** (rank 10, perms {manage_roles, manage_channels}) **can** create a role at
   position 5 with perms `[manage_channels]` (below rank + subset).
3. Alice **cannot** create a role at position 10 (== rank) or 15 (> rank).
4. Alice **cannot** create a role at position 5 with `[manage_server]` (perm she lacks).
5. Alice **can** update a below-role's position from 3 → 8 (still < 10); **cannot** move it to
   20 (≥ rank).
6. Alice **cannot** edit her own highest role (position 10).
7. Alice **can** assign a below-her role (position 5) to a member; **cannot** assign a role at
   position 10 or above.
8. A **no-`manage_roles`** member cannot create, edit, delete, or assign any role.
9. Owner can still delete/reassign everything (bypass re-confirmed after the above).

`npm run build` clean; full `npx vitest run` green (unchanged — no client code in D3a).

## Operational note

Run `0014_role_hierarchy.sql` in the Supabase SQL editor before the smoke test / D3b. It
revises only the roles/member_roles management policies + adds four helper functions;
non-owners' access to *other* resources (channels/servers via `has_server_permission`) is
unchanged.
