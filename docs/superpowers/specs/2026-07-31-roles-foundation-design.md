# Custom roles — D1 foundation (data + permission resolution) — design

**Date:** 2026-07-31
**Sub-project:** Full custom roles (permission-carrying). This is slice **D1** of 4:
D1 foundation → D2 RLS cutover → D3 management UI → D4 display.
**Status:** approved, ready for planning

## Goal

Lay the data model, permission-resolution function, and seed data for permission-carrying
custom roles — **without changing any access control yet**. After D1, the app behaves
exactly as before (existing `is_server_admin` still governs every management action); D1 only
makes it *possible* for D2 to flip RLS onto roles safely.

## Decisions (from brainstorming)

- **Roles replace the tier** (end state). **Owner is a hardcoded super-user** — always has all
  permissions via `servers.owner_id`, needs no role. Everyone else's permissions come only
  from roles they're assigned. Members can hold **multiple** roles.
- **Permission set (5):** `manage_channels`, `manage_server`, `manage_roles`, `kick_members`,
  `manage_messages`.
- **Non-breaking:** D1 does NOT cut over RLS. Existing management policies keep using
  `is_server_admin`. Role-table management is gated by `is_server_admin` for now (D2/D3 switch
  it to `manage_roles`). The `server_members.role` column is left untouched until the cutover.
- **Seed for a safe cutover:** for each server, create an "Admin" role holding all 5 perms and
  assign it to everyone currently `role = 'admin'`, so when D2 flips RLS those users keep
  access. Owner gets nothing (hardcoded).

## Data model — `supabase/migrations/0012_roles_foundation.sql`

```sql
-- roles: named, colored, permission-bearing, per server
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  name text not null,
  color text,                                   -- hex like '#7c9cff', nullable
  permissions text[] not null default '{}',
  position int not null default 0,
  created_at timestamptz not null default now(),
  constraint roles_valid_permissions check (
    permissions <@ array['manage_channels','manage_server','manage_roles','kick_members','manage_messages']::text[]
  )
);

-- member_roles: a member can hold multiple roles
create table public.member_roles (
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  primary key (server_id, user_id, role_id)
);

-- permission resolver: owner is a hardcoded super-user; else union of assigned roles' perms
create or replace function public.has_server_permission(srv uuid, perm text)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from public.servers s where s.id = srv and s.owner_id = auth.uid())
      or exists (
        select 1 from public.member_roles mr
        join public.roles r on r.id = mr.role_id
        where mr.server_id = srv and mr.user_id = auth.uid()
          and perm = any(r.permissions)
      );
$$;
grant execute on function public.has_server_permission(uuid, text) to authenticated;

-- RLS: readable by members; management gated by is_server_admin FOR NOW (D2/D3 → manage_roles)
alter table public.roles enable row level security;
alter table public.member_roles enable row level security;

create policy "members read roles" on public.roles for select to authenticated
  using (public.is_server_member(server_id));
create policy "admins insert roles" on public.roles for insert to authenticated
  with check (public.is_server_admin(server_id));
create policy "admins update roles" on public.roles for update to authenticated
  using (public.is_server_admin(server_id));
create policy "admins delete roles" on public.roles for delete to authenticated
  using (public.is_server_admin(server_id));

create policy "members read member_roles" on public.member_roles for select to authenticated
  using (public.is_server_member(server_id));
create policy "admins insert member_roles" on public.member_roles for insert to authenticated
  with check (public.is_server_admin(server_id));
create policy "admins delete member_roles" on public.member_roles for delete to authenticated
  using (public.is_server_admin(server_id));

-- realtime
alter publication supabase_realtime add table public.roles;
alter publication supabase_realtime add table public.member_roles;

-- seed: an "Admin" role (all 5 perms) per server, assigned to current admins
do $$
declare s record; rid uuid;
begin
  for s in select id from public.servers loop
    insert into public.roles (server_id, name, color, permissions, position)
      values (s.id, 'Admin', '#7c9cff',
        array['manage_channels','manage_server','manage_roles','kick_members','manage_messages'], 1)
      returning id into rid;
    insert into public.member_roles (server_id, user_id, role_id)
      select s.id, m.user_id, rid
      from public.server_members m
      where m.server_id = s.id and m.role = 'admin';
  end loop;
end $$;
```

Notes:
- `permissions <@ array[...]` enforces that only the 5 valid keys can be stored (superset
  check; empty array is valid).
- Seeding runs once at migration time. New servers created after D1 get their Admin role in
  D3 (the management UI) or a later `create_server` update — D1 does not change
  `create_server` (out of scope; existing servers are covered, and D2's cutover keeps
  `is_server_admin` as the owner path so a brand-new server's owner is never locked out).

## Types + helper

- `src/types/db.ts`: add
  ```ts
  export type Role = {
    id: string; server_id: string; name: string; color: string | null;
    permissions: string[]; position: number; created_at: string;
  };
  export type MemberRole = { server_id: string; user_id: string; role_id: string };
  ```
- `src/lib/permissions.ts` (pure, tested):
  ```ts
  export const PERMISSIONS = [
    "manage_channels", "manage_server", "manage_roles", "kick_members", "manage_messages",
  ] as const;
  export type Permission = (typeof PERMISSIONS)[number];
  export const PERMISSION_LABELS: Record<Permission, string> = {
    manage_channels: "Manage Channels",
    manage_server: "Manage Server",
    manage_roles: "Manage Roles",
    kick_members: "Kick Members",
    manage_messages: "Manage Messages",
  };
  export function isPermission(x: string): x is Permission {
    return (PERMISSIONS as readonly string[]).includes(x);
  }
  ```

## Non-goals (YAGNI / later slices)

- No RLS cutover — existing `is_server_admin` still governs management (that's **D2**).
- No role management UI, no assignment UI (**D3**).
- No colored names/badges (**D4**).
- No `@everyone` baseline role, no role hierarchy/position enforcement, no per-channel
  permission overrides (Discord has these; out of scope for a 30-friend app).
- `create_server` is not modified in D1.

## Testing

- **Unit** (`tests/permissions.test.ts`): `PERMISSIONS` has the 5 keys; `PERMISSION_LABELS`
  covers all 5; `isPermission` accepts a valid key and rejects an unknown one.
- **Backend smoke** (live DB, throwaway users + a throwaway server):
  1. `has_server_permission(srv, 'manage_channels')` is **true for the owner** for every perm.
  2. A member with **no roles** → **false** for every perm.
  3. Create a role granting only `manage_channels`, assign it to a member → **true** for
     `manage_channels`, **false** for the other four.
  4. The seeded **"Admin"** role exists per server and a pre-existing admin resolves **true**
     for all 5 (verify against a server that had an admin before the migration, or assign the
     seeded role and check).
  5. **Non-breaking check:** existing management still works unchanged — an admin can still
     create a channel, a plain member still cannot (RLS untouched in D1).

## Operational note

Run `0012_roles_foundation.sql` in the Supabase SQL editor before the smoke test / live use.
Non-breaking: existing servers gain the tables + a seeded Admin role; no access changes.
