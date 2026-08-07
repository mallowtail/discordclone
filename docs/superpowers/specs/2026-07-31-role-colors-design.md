# Custom roles — D4 colored names + role pills — design

**Date:** 2026-07-31
**Sub-project:** Full custom roles. Slice **D4** of 5 (D1 ✅ → D2 ✅ → D3a ✅ → D3b ✅ → **D4 display**). Final custom-roles slice.
**Status:** approved, ready for planning

## Goal

Make roles visible: tint a member's **name** by their highest colored role in the member list,
chat author names, and the profile card; show the member's **roles as colored pills** on the
profile card. Read-only display — tables/RLS already exist (D1–D3a); no migration.

## Decisions (from brainstorming)

- Name color = the color of the member's **highest-position role that has a color** (Discord's
  rule); if none, the default `text-ink`.
- Colored names in: **member list**, **chat author names**, **profile card**.
- **Role pills** (colored chip + name, highest first) only on the **profile card** (member list
  shows colored names only).
- **No owner marker anywhere** — remove the existing "OWNER" badges from `MembersPanel` and
  `ProfileCard` (no crown, no text). Owner is a normal member visually; their name still takes
  a role color if they hold a colored role.
- Chat coloring adds one server-roles fetch to the message view (per server, once) — accepted.
- Realtime: colors refresh on view remount / dialog reopen (role changes are rare); no live
  chat recolor.

## Components

### Pure helper (tested) — `src/lib/roleColor.ts`
```ts
type ColoredRole = { position: number; color: string | null };
/** Color of the highest-position role that has a color; null if none. */
export function topRoleColor(roles: ColoredRole[]): string | null {
  const colored = roles.filter((r) => r.color);
  if (colored.length === 0) return null;
  return colored.reduce((top, r) => (r.position > top.position ? r : top)).color;
}
```

### Hook — `src/hooks/useMemberRoleColors.ts`
Fetches the server's assignments once and exposes per-user lookups.
`useMemberRoleColors(serverId: string | null | undefined)` →
`{ colorFor(userId): string | null; rolesFor(userId): Role[]; loading: boolean }`.
- Query: `member_roles` for the server joined to `roles` (`select role_id, roles(*)` with
  `.eq("server_id", serverId)`), grouped into `Map<userId, Role[]>` (each list sorted by
  `position` desc). `rolesFor` returns `[]` for unknown users; `colorFor` = `topRoleColor` over
  that list. Returns `{ colorFor: () => null, rolesFor: () => [] }` when `serverId` is falsy.
- Members can read roles/member_roles (RLS from D1), so a normal fetch works.

### `src/components/servers/RolePill.tsx`
`{ role: { name: string; color: string | null } }` → an inline chip:
```tsx
<span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink">
  <span className="w-2 h-2 rounded-full flex-none" style={{ background: role.color ?? "var(--color-muted)" }} />
  <span className="truncate max-w-[120px]">{role.name}</span>
</span>
```

## Wiring

### `MembersPanel.tsx`
- Add `const { colorFor } = useMemberRoleColors(serverId);`.
- The member name `<div className="text-ink text-sm truncate">` → apply the color:
  `style={{ color: colorFor(m.user_id) ?? undefined }}` (keep `text-ink` as the fallback when
  the style is undefined).
- **Remove** `badge()` and its OWNER span, and the now-unused `ownerId` state + its fetch (the
  `servers.owner_id` select). Keep the roles-management `ShieldStar` button and everything else.

### `ProfileCard.tsx`
- **Remove** the `role`/`RoleLabel` state, the owner-resolution `useEffect`, and the
  `{role === "OWNER" && ...}` badge span.
- Add `const { colorFor, rolesFor } = useMemberRoleColors(serverId);`.
- Color the display-name span: `style={{ color: colorFor(userId) ?? undefined }}`.
- Below the `@username` line, render the member's role pills when there are any:
  `{rolesFor(userId).map((r) => <RolePill key={r.id} role={r} />)}` in a `flex flex-wrap gap-1
  mt-2` row. (No pills / no color when `serverId` is absent — DM context.)
- The card height changes with pills → the existing `useLayoutEffect` position recompute already
  depends on content; add `rolesFor(userId)`-derived length to its deps if needed so it
  re-measures after pills load.

### Chat author names — `MessageList.tsx` + `MessageItem.tsx`
- `MessageList` already has `serverId` and maps author `profiles`. Add
  `const { colorFor } = useMemberRoleColors(serverId);` and pass `authorColor={colorFor(m.author_id)}`
  to each `<MessageItem>`.
- `MessageItem` gains an optional `authorColor?: string | null` prop; apply it to the author-name
  button: `style={{ color: authorColor ?? undefined }}` (keeps `text-ink` fallback + the
  hover:underline + click-to-profile behavior). In DMs (`serverId` undefined) `authorColor` is
  null → default.

## Non-goals

- No owner/crown indicator (removed per decision).
- No live recolor of already-rendered chat on role change (refresh on remount).
- No role management here (that's D3b) — display only.
- No coloring in the DM sidebar (no server context).

## Testing

- **Unit:** `topRoleColor` — highest-position colored role wins; a higher role with `null` color
  is skipped in favor of the next colored one; empty → `null` (`tests/roleColor.test.ts`).
- **Build:** `npm run build` clean; `npx vitest run` green (adds the topRoleColor tests).
- **Manual:** give a member a colored role → their name is tinted in the member list, in chat,
  and on their profile card; the profile card shows their role pills (highest first); a member
  with no colored role shows the default ink name; the OWNER badge is gone everywhere.

## Operational note

No migration, no dependency, no env change. Front-end branch. (Members can already read
`roles`/`member_roles` via existing RLS.)
