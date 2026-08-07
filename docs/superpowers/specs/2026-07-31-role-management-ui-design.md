# Custom roles — D3b role management UI + permission-aware gating — design

**Date:** 2026-07-31
**Sub-project:** Full custom roles. Slice **D3b** of 5 (D1 ✅ → D2 ✅ → D3a ✅ → **D3b UI** →
D4 display).
**Status:** approved, ready for planning

## Goal

Make roles usable: a UI to create/edit/delete/reorder roles (name, color, permissions) and
assign them to members, plus switching the client from the owner-only interim gating to real
**permission-aware** gating. All UI mirrors the D3a hierarchy RLS (which remains the actual
enforcement). No migration, no new dependency.

## Decisions (from brainstorming)

- Reordering via **▲/▼** (swap position with neighbor) — included now.
- Color = **preset swatches + a custom hex** input.
- Role editor lives in a dedicated **`RolesDialog`** opened from a "Manage roles" button in
  server settings. Assignment lives in a per-member **`MemberRolesDialog`** opened from the
  member panel.
- The UI disables any action the RLS would reject (roles at/above your rank; permissions you
  don't hold) — the RLS is still the real guard.

## Current state

- Gating is owner-only via `src/hooks/useServerRole.ts` (`isManager === isOwner`). `ServerSidebar`
  uses `isManager` to gate +Channel/+Category and passes it to `ServerSettingsDialog`
  (gates icon/name/visibility; Leave ungated). `MembersPanel` has no permission hook (rows open
  the profile popover). RLS is fully hierarchy-aware (D3a): `my_permissions(srv)`,
  `my_role_rank(srv)`, `can_manage_role(...)`, `can_assign_role(...)`. `roles` has
  `{id, server_id, name, color, permissions, position}`; `member_roles` is
  `{server_id, user_id, role_id}`. `PERMISSIONS`/`PERMISSION_LABELS` in `src/lib/permissions.ts`.

## Components

### Pure helpers (tested)

- `src/lib/roleHierarchy.ts`:
  - `canManageRoleClient(rolePosition: number, myRank: number | null, isOwner: boolean): boolean`
    — `isOwner || (myRank !== null && rolePosition < myRank)`. (mirror of `can_manage_role` rank rule)
  - `canTogglePermClient(perm: string, myPerms: string[], isOwner: boolean): boolean`
    — `isOwner || myPerms.includes(perm)`.
- `src/lib/roleColors.ts`:
  - `export const ROLE_COLORS: string[]` — ~10 preset hex swatches (reuse theme-ish accents,
    e.g. `#7c9cff, #f0b86b, #3ba55d, #f87171, #a78bfa, #f472b6, #22d3ee, #94a3b8, #eab308, #fb923c`).
  - `validateHexColor(s: string): boolean` — true for `#rgb` or `#rrggbb` (case-insensitive).

### `src/hooks/useServerPermissions.ts` (new; replaces `useServerRole`)

Returns `{ perms: string[]; isOwner: boolean; rank: number | null; has: (perm: Permission) => boolean; loading: boolean }`.
Fetches `servers.owner_id` (→ `isOwner`) and calls RPCs `my_permissions({ srv })` (→ `perms`;
owner already yields all five) and `my_role_rank({ srv })` (→ `rank`). `has(perm) = perms.includes(perm)`.
Subscribes to nothing (re-fetches on serverId/user change); role changes are rare and a
dialog close/reopen refreshes.

### `src/components/servers/RoleEditor.tsx`

Form for creating/editing one role. Props:
`{ serverId: string; role?: Role | null; myPerms: string[]; isOwner: boolean; onDone: () => void; onCancel: () => void }`.
- Fields: **name** (`<input>`), **color** — a row of `ROLE_COLORS` swatch buttons plus a custom
  `<input>` for a hex (validated with `validateHexColor`; a selected swatch fills the hex too);
  **permissions** — a checkbox per `PERMISSIONS` entry (`PERMISSION_LABELS` for text), each
  `disabled={!canTogglePermClient(perm, myPerms, isOwner)}`.
- Save: if `role` given → `update` (name/color/permissions) `.eq('id', role.id)`; else `insert`
  a new role with `server_id`, name, color, permissions, and `position` = **bottom of the
  hierarchy** (`(min existing roles.position for this server) - 1`, or `1` if none — computed
  from a roles list passed in or re-queried). Surface RLS errors ("Not allowed" on failure).
  Calls `onDone()` on success.
- Only reachable for roles the caller may manage (RolesDialog gates the ⚙); new-role creation is
  gated by the "Manage roles" entry (`has('manage_roles')`).

### `src/components/servers/RolesDialog.tsx`

Opened from server settings. Loads the server's roles (ordered by `position` **desc**). Renders:
- A "+ New role" button → opens `RoleEditor` (create mode).
- Each role row: color dot (or neutral), name, **▲/▼** reorder, **⚙ edit**, **✕ delete**.
  Each row's controls are `disabled` when `!canManageRoleClient(role.position, rank, isOwner)`.
- **▲/▼**: swap `position` with the adjacent role in the sorted list (two `update`s). Guard so a
  swap that would place a role at/above your rank is disabled.
- **✕ delete**: `confirm()` then `delete().eq('id', role.id)` (member_roles cascade).
- Uses `useServerPermissions(serverId)` for `rank`/`isOwner`/`perms`; passes `perms`/`isOwner` to
  `RoleEditor`. Realtime on `roles` (`postgres_changes`) to keep the list fresh, or re-load after
  each mutation.

### `src/components/servers/MemberRolesDialog.tsx`

Props `{ serverId: string; userId: string; onClose: () => void }`. Loads the server's roles +
that member's current `member_roles`. Renders a checkbox per role (color dot + name); checked =
assigned. Each checkbox `disabled` when `!canManageRoleClient(role.position, rank, isOwner)`
(can't assign at/above your rank). Toggle on → `insert` into `member_roles`; off → `delete`.
Surfaces RLS errors. `useServerPermissions` for rank/owner.

### Wiring changes

- **`ServerSidebar.tsx`:** replace `useServerRole` with `useServerPermissions`. Gate +Channel and
  +Category with `has('manage_channels')`. Pass permission info to `ServerSettingsDialog`
  (see below). (The ⚙ still opens settings for everyone; content is gated inside.)
- **`ServerSettingsDialog.tsx`:** change the `isManager` prop to `canManageServer: boolean`
  (= `has('manage_server')`) gating the icon/name/visibility block; add a **"Manage roles"**
  button — rendered only when a new `canManageRoles: boolean` prop is true — that opens
  `RolesDialog`. Leave button stays for all. (ServerSidebar computes both from
  `useServerPermissions` and passes them in.)
- **`MembersPanel.tsx`:** use `useServerPermissions(serverId)`; when `has('manage_roles')`, render
  a small **roles** button (🏷 / "Roles") on each member row that opens `MemberRolesDialog` for
  that `user_id`. (Keep the existing avatar/name → profile popover.)
- **DELETE `src/hooks/useServerRole.ts`** (now unused). Confirm no other importers first.

## Non-goals (YAGNI / later)

- No colored names/badges in chat/member list yet (**D4** — this slice only edits/assigns).
- No drag-to-reorder (▲/▼ only).
- No `@everyone` baseline role, no per-channel overrides, no permission descriptions/tooltips.
- `create_server` unchanged (new servers stay owner-managed until the owner makes roles).

## Testing

- **Unit:** `roleHierarchy.ts` (`canManageRoleClient` boundary: below/equal/above rank, owner
  bypass, null rank; `canTogglePermClient` owner/has/lacks) and `roleColors.ts`
  (`validateHexColor` accept `#abc`/`#aabbcc`, reject `abc`/`#gggggg`/empty) in
  `tests/roleHierarchy.test.ts` + `tests/roleColors.test.ts`.
- **Backend smoke** (live DB, throwaway owner + member): through the same client calls the UI
  makes — owner creates a role (with a permission), assigns it to the member, the member's
  `my_permissions` now includes it, unassign removes it, delete the role removes it (and its
  assignments). Confirms the UI's data path end-to-end.
- **Manual:** as owner — open Manage roles, create a role (name+color+perms), reorder with ▲/▼,
  edit, delete; assign a role to a member from the member panel; confirm gating (e.g. a member
  granted `manage_channels` now sees +Channel). `npm run build` clean; `npx vitest run` green.

## Operational note

No migration, no dependency. Ships as a normal front-end branch. (RLS from D3a already enforces
everything server-side; this slice is the UI + the permission-aware client gating.)
