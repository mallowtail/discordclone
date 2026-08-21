# Moderation — kick / ban / timeout — design

**Date:** 2026-08-14
**Sub-project:** Moderation (single combined slice: kick + ban + timeout).
**Status:** approved, ready for planning

## Goal

Give permission-holders three moderation actions on a server, enforced in the database (RLS +
SECURITY DEFINER RPCs) and surfaced in the Members panel + Server Settings:

- **Kick** — remove a member from the server. They may rejoin (invite/directory).
- **Ban** — remove a member and block rejoin; reversible via a Banned list. Optional reason.
- **Timeout** — temporarily block a member from **sending messages and adding reactions** in the
  server until an expiry (preset durations). They can still read.

## Decisions (from brainstorming)

- **Three granular permissions:** keep `kick_members`, add `ban_members`, `timeout_members`.
- **Owner** (servers.owner_id) can always do all three. **Role hierarchy** applies to every action:
  a moderator can only act on a member whose highest role rank is **strictly below** their own, and
  **never** on the owner or on themselves.
- **Timeout durations (presets):** 5 min, 10 min, 1 hour, 1 day, 1 week. Blocks **messages + reactions**
  (both enforced in RLS). Read-only access is unaffected.
- **Ban:** does NOT delete the banned member's past messages. Optional **reason**. Reversible via a
  **Banned list in Server Settings** (Unban), gated by `ban_members`.
- All mutations go through **SECURITY DEFINER RPCs** that enforce permission + hierarchy atomically;
  passive **RLS** independently blocks banned users from rejoining and timed-out users from posting
  (defense in depth — a hacked client can't bypass either).

## Schema — migration `supabase/migrations/0018_moderation.sql`

1. **Widen the roles permission allowlist** (from `0012`):
```sql
alter table public.roles drop constraint if exists roles_valid_permissions;
alter table public.roles add constraint roles_valid_permissions check (
  permissions <@ array['manage_channels','manage_server','manage_roles',
    'kick_members','ban_members','timeout_members','manage_messages']::text[]
);
```
2. **Timeout column** on membership:
```sql
alter table public.server_members add column if not exists timeout_until timestamptz;
```
3. **Bans table:**
```sql
create table if not exists public.bans (
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  banned_by uuid references public.profiles(id),
  reason    text,
  created_at timestamptz not null default now(),
  primary key (server_id, user_id)
);
alter table public.bans enable row level security;
```

### Helper functions (SECURITY DEFINER, `set search_path = public`)

- `is_banned(srv uuid) returns boolean` — `exists(select 1 from bans where server_id=srv and user_id=auth.uid())`.
- `is_timed_out(srv uuid) returns boolean` — `exists(select 1 from server_members where server_id=srv
  and user_id=auth.uid() and timeout_until is not null and timeout_until > now())`.
- `is_timed_out_channel(chan uuid) returns boolean` — resolves `chan`→`channels.server_id` then
  `is_timed_out(server_id)`; returns false when the channel/server can't be resolved.
- `is_timed_out_message(msg uuid) returns boolean` — resolves `msg`→`messages.channel_id`→server and
  checks timeout; returns **false** for DM messages (no channel/server → no timeout concept).
- `server_role_rank(srv uuid, uid uuid) returns int` — the max `roles.position` among the target's
  roles in that server. For a member with **no roles**, return the SAME floor value the existing
  `my_role_rank` self-helper uses (the plan must read `my_role_rank`'s definition and match it — e.g.
  `coalesce(max(position), <floor>)`), so viewer/target comparisons are consistent. (This is a
  user-parameterized mirror of `my_role_rank`, reused by `can_moderate`. The owner never relies on
  rank — `can_moderate` short-circuits on the owner both as caller and as target.)
- `can_moderate(srv uuid, target uuid, perm text) returns boolean` — true iff `auth.uid()` may apply
  `perm` to `target`:
  - `target <> auth.uid()` (never self), and
  - `target <> servers.owner_id` (never the owner), and
  - caller is the **owner** OR (`has_server_permission(srv, perm)` AND
    `server_role_rank(srv, auth.uid()) > server_role_rank(srv, target)`).

### Mutation RPCs (SECURITY DEFINER; raise `exception` on violation)

Each first checks `can_moderate(srv, target, '<perm>')`; if false, `raise exception 'not permitted'`.
- `kick_member(srv uuid, target uuid)` → `can_moderate(srv,target,'kick_members')`; `delete from
  server_members where server_id=srv and user_id=target`.
- `ban_member(srv uuid, target uuid, reason text)` → `can_moderate(srv,target,'ban_members')`;
  `insert into bans(server_id,user_id,banned_by,reason) values(srv,target,auth.uid(),reason)
  on conflict (server_id,user_id) do update set reason=excluded.reason, banned_by=excluded.banned_by`;
  then `delete from server_members where server_id=srv and user_id=target` (atomic — both in one function).
- `unban_member(srv uuid, target uuid)` → requires owner or `has_server_permission(srv,'ban_members')`
  (no hierarchy check needed — target isn't a member); `delete from bans where server_id=srv and user_id=target`.
- `timeout_member(srv uuid, target uuid, until timestamptz)` → `can_moderate(srv,target,'timeout_members')`;
  `update server_members set timeout_until=until where server_id=srv and user_id=target`. (`until=null`
  clears a timeout — same RPC.)

`grant execute` on all five to `authenticated`.

### RLS changes (passive enforcement / defense in depth)

- **Block rejoin when banned** — replace the join policy:
```sql
drop policy if exists "self join server" on public.server_members;
create policy "self join server" on public.server_members for insert to authenticated
  with check (user_id = auth.uid() and not public.is_banned(server_id));
```
- **Timed-out users can't send** — replace `send messages` (from `0005`) adding the channel-timeout guard:
```sql
drop policy if exists "send messages" on public.messages;
create policy "send messages" on public.messages for insert to authenticated
  with check (
    author_id = auth.uid() and (
      (channel_id is not null and public.is_channel_member(channel_id)
        and not public.is_timed_out_channel(channel_id))
      or (conversation_id is not null and public.is_conversation_member(conversation_id))
    )
  );
```
  (DMs are unaffected — timeout is server-scoped.)
- **Timed-out users can't react** — replace `add own reactions` (from `0002`):
```sql
drop policy if exists "add own reactions" on public.reactions;
create policy "add own reactions" on public.reactions for insert to authenticated
  with check (user_id = auth.uid() and public.can_read_message(message_id)
    and not public.is_timed_out_message(message_id));
```
- **Bans table policies:**
```sql
create policy "read bans (ban_members)" on public.bans for select to authenticated
  using (public.has_server_permission(server_id,'ban_members')
    or server_id in (select id from public.servers where owner_id = auth.uid()));
```
  (No client insert/delete policies — bans are written only via the SECURITY DEFINER RPCs, which
  bypass RLS. This means no direct-table ban writes are possible, which is what we want.)

## App types & permissions

- `src/lib/permissions.ts`: add `"ban_members"`, `"timeout_members"` to `PERMISSIONS` and
  `PERMISSION_LABELS` (`Ban Members`, `Timeout Members`). The RoleEditor renders these automatically.
- `src/types/db.ts`: add `timeout_until: string | null` to the membership type if one exists; add a
  `Ban` type (`server_id, user_id, banned_by, reason, created_at`).

## Client hierarchy mirror (tested)

`src/lib/moderation.ts` — a pure helper mirroring `can_moderate` so the UI only offers actions RLS
would allow (RLS remains the real guard):
```ts
export function canModerate(opts: {
  isOwner: boolean;            // viewer is server owner
  hasPerm: boolean;           // viewer has the specific permission
  viewerRank: number;         // viewer's top role rank
  targetRank: number;         // target's top role rank
  targetIsOwner: boolean;
  targetIsSelf: boolean;
}): boolean;
```
Rule: `!targetIsSelf && !targetIsOwner && (isOwner || (hasPerm && viewerRank > targetRank))`.

## UI

### Members panel — per-member action menu (`MembersPanel.tsx`)
- Each member row (except self/owner rows where nothing applies) gets a **⋯** button opening a small
  menu (reuse the composer/toolbar popover idiom: outside-click + Escape close). Items, each shown only
  when `canModerate(...)` is true for that permission:
  - **Timeout ▸** submenu of the five presets → calls `timeout_member(srv, target, now + preset)`.
    If the member is currently timed out, also show **Remove timeout** → `timeout_member(srv, target, null)`.
  - **Kick** (confirm dialog) → `kick_member`.
  - **Ban** (confirm dialog with an optional reason input) → `ban_member`.
- A currently timed-out member shows a small **clock glyph** + tooltip “Timed out until <time>”
  (needs the member's `timeout_until`; fetch it alongside the member list).

### Server Settings — Banned list (`ServerSettingsDialog.tsx`)
- When the viewer has `ban_members` (or is owner), a **Banned** section lists banned users
  (join `bans`→`profiles` for name/avatar) with the reason and an **Unban** button → `unban_member`.
  Reuse the existing settings-row styling.

### Composer — own-timeout UX (`MessageInput.tsx`)
- The current user can read their own `server_members.timeout_until`. When timed out in the active
  server, **disable** the textarea + buttons and show “You're timed out until <time>.” instead of the
  placeholder. (Prevents a confusing silent send-failure; RLS is still the true block.)

## Realtime / refresh

- Kicked/banned target: their `server_members` row disappears; the existing `useServers`/member
  subscriptions drop the server on refresh. No live force-redirect required (they lose access on next
  read; acceptable). Members panel updates via its existing realtime subscription.
- Timeout state refreshes on member-list reload / composer mount (timeouts are short; no live tick).

## Non-goals

- No message-deletion on ban; no “delete last N messages” option.
- No custom timeout duration input (presets only); no timeout for DMs (server-scoped only).
- No audit log / mod-action history; no ban appeals; no temporary bans (bans are until unbanned).
- No voice (there is none).

## Testing

- **Unit** (`tests/moderation.test.ts`): `canModerate` truth table — owner may act on anyone but self
  and the owner-target; a permitted mod may act on strictly-lower ranks only; equal/higher rank
  blocked; self blocked; owner-target blocked; missing permission blocked (non-owner).
- **Migration:** controller diffs `0018_moderation.sql` verbatim vs this spec; applies it before manual.
- **Build/tests:** `npm run build` clean; `npx vitest run` green (adds moderation tests).
- **Manual (multi-user, localhost):**
  - As a non-owner with each permission, verify the ⋯ menu only offers actions hierarchy allows; the
    owner and higher/equal-rank members show no actionable items.
  - **Kick:** target loses the server; can rejoin via invite.
  - **Ban:** target loses the server and **cannot** rejoin (join blocked); appears in Server Settings →
    Banned with reason; **Unban** lets them rejoin.
  - **Timeout:** target can't send messages or add reactions until expiry (both fail server-side); their
    composer shows the timed-out notice; **Remove timeout** restores posting; DMs still work.
  - Direct-table attempts (e.g. a member trying to `delete` someone else's membership, or a timed-out
    user inserting a message/reaction) are rejected by RLS.

## Operational note

One migration (`0018_moderation.sql`): the widened roles CHECK, `server_members.timeout_until`, the
`bans` table + RLS, helper functions, and five SECURITY DEFINER RPCs. No new dependency, no env change.
Everything else is front-end. Bans/timeouts are written only through the RPCs (which enforce
permission + hierarchy); RLS independently blocks rejoin and posting while banned/timed-out.
