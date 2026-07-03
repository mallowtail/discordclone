# Roles & Permissions + Optimistic Message Send

**Date:** 2026-07-03
**Status:** Approved design, ready for implementation planning

## Context

Two things bundled by user request:

1. **Roles & permissions** — the next slice of sub-project #3 (server management). Today a
   server is fully "member-editable": any member can create/edit channels & categories,
   rename the server, and change roles (well, membership). We add a simple tiered role model
   and gate the management operations to admins/owner.
2. **Optimistic message send** — a small UX polish: a just-sent message appears immediately
   at reduced opacity ("pending"), then becomes fully opaque once the insert confirms
   (Discord-like). Today a message only appears after the DB round-trip.

Current relevant state (from the multi-server slice, merged): `servers` (with `owner_id`),
`server_members(server_id, user_id, joined_at)`, `categories`, per-server `channels`;
membership-based RLS via `is_server_member`/`is_channel_member`; `create_server` sets
`owner_id = auth.uid()`. The migrated **"Our Server"** has `owner_id = null`. Registration
currently auto-joins the oldest server; `/dms` is an empty-home safety net.

Deferred to later slices of sub-project #3: moderation (kick/ban/timeout), invite links.

## Goal

1. Add roles: **owner** (implicit = `servers.owner_id`), **admin**, **member**. Gate
   channel/category/server management and role management to owner+admins; keep chat open to
   all members.
2. A **members panel** (right side, per server) showing members + role badges, with
   promote/demote controls for managers. (Delivers the member-list feature too.)
3. **Delete "Our Server"** (the ownerless legacy server) so everyone starts fresh with
   properly-owned servers.
4. **Optimistic message send** with the gray→opaque effect.

## Scope

### In scope
- `server_members.role` (`'admin' | 'member'`, default `'member'`); `is_server_admin(srv)`
  helper (owner OR role='admin').
- RLS: channels/categories create/edit/delete and server rename/icon → `is_server_admin`;
  role updates on `server_members` → `is_server_admin`; self-join tightened to
  `role = 'member'`; chat/read/join/leave unchanged.
- Migration deletes the ownerless "Our Server"; remove the register auto-join.
- `useServerRole(serverId)` hook; `MembersPanel`; a **👥 Members** toggle in the channel
  header; manager-gating of the sidebar create buttons + settings gear; settings rename/icon
  gated to managers (Leave stays for everyone).
- Optimistic send: `useMessages` gains `addPending`/`removePending`; INSERT handler
  replaces-by-id; `MessageItem` dims when `pending`; `Message` gets a client-only `pending`.

### Out of scope (later)
- Moderation actions (kick/ban/timeout) and audit logs.
- Invite links / private servers (open directory remains).
- Custom roles / granular permission bitfields (fixed 3-tier only).
- Ownership transfer, server deletion via UI (owner is fixed; only the legacy server is
  deleted, in the migration).
- Per-channel permissions or private channels.

## Role Model

- **owner**: the member whose `user_id = servers.owner_id`. Full power; cannot be demoted
  (power derives from `owner_id`, not the role column). Set only by `create_server`.
- **admin**: `server_members.role = 'admin'`. Can manage channels/categories, rename/icon the
  server, moderate (later), and manage roles (promote/demote members and other admins).
- **member**: default. Chat, react, reply, DMs, join/leave. No management.
- **Manager** = owner OR admin (`is_server_admin`).

## Database Changes

New migration `supabase/migrations/0007_roles.sql`:

- `alter table public.server_members add column role text not null default 'member' check (role in ('admin','member'));`
- Helper:
  ```sql
  create or replace function public.is_server_admin(srv uuid)
  returns boolean language sql security definer set search_path = public as $$
    select exists (
      select 1 from public.servers s where s.id = srv and s.owner_id = auth.uid()
    ) or exists (
      select 1 from public.server_members m
      where m.server_id = srv and m.user_id = auth.uid() and m.role = 'admin'
    );
  $$;
  ```
- **Tighten self-join** (drop + recreate): `with check (user_id = auth.uid() and role = 'member')`
  — a joining user cannot self-assign admin.
- **Role management**: new UPDATE policy on `server_members`:
  `using (public.is_server_admin(server_id)) with check (public.is_server_admin(server_id))`.
- **Gate management to admins** (drop + recreate the multi-server slice's member-level write
  policies):
  - `channels` INSERT/UPDATE/DELETE → `is_server_admin(server_id)`.
  - `categories` INSERT/UPDATE/DELETE → `is_server_admin(server_id)`.
  - `servers` UPDATE → `is_server_admin(id)` (was `is_server_member`). The
    `protect_server_owner` trigger stays.
- Channel/message read + send policies (membership-based) and self-leave are **unchanged**.
- **Delete the legacy server**: `delete from public.servers where owner_id is null;` (cascades
  to its channels, those channels' messages, categories, and memberships).

## Types

- `src/types/db.ts`: `ServerMember` gains `role: "admin" | "member"`; `Message` gains an
  optional client-only `pending?: boolean`.

## Components & Files

### Optimistic send
- `src/hooks/useMessages.ts` — add `addPending(msg: Message)` and `removePending(id)` to the
  returned value; change the realtime INSERT handler to **replace an existing id** (so the
  real row supersedes the optimistic one and clears `pending`) instead of skipping.
- `src/components/MessageInput.tsx` — on send: generate `id = crypto.randomUUID()`, build the
  optimistic `Message` (`pending: true`, includes reply/image fields), `addPending`, then
  insert with that id; on error `removePending(id)` + restore text. Applies to both the text
  and image send paths.
- `src/components/MessageItem.tsx` — dim the content wrapper (e.g. `opacity-50`) when
  `msg.pending`.
- `useMessages` return type changes from `Message[]` to `{ messages, addPending, removePending }`;
  update the two call sites (`ChannelView`, `DmPage`) accordingly.

### Roles / permissions
- `src/hooks/useServerRole.ts` — NEW: `useServerRole(serverId): { role, isOwner, isManager, loading }`.
- `src/components/MembersPanel.tsx` — NEW: right-side panel; lists members (avatar, name, role
  badge) for a server; manager promote/demote controls; live via realtime on `server_members`.
- `src/app/(app)/channels/[channelId]/page.tsx` — add a **👥 Members** toggle in the header
  (next to Pinned) that opens `MembersPanel` for `channel.server_id`.
- `src/components/ServerSidebar.tsx` — show **+ Channel / + Category** and the settings gear
  only when `useServerRole(serverId).isManager`.
- `src/components/ServerSettingsDialog.tsx` — show rename + icon controls only for managers;
  keep **Leave server** for everyone.
- `src/app/register/page.tsx` — remove the auto-join-oldest-server block (no default server
  now).

## UX Details

- **Optimistic message**: your message shows instantly at ~50% opacity; flips to full opacity
  when the realtime echo of the same id arrives. On failure it disappears and your text
  returns with an inline error.
- **Members panel**: role badges — Owner (accent), Admin (muted pill), Member (plain).
  Managers see "Make admin"/"Remove admin" per non-owner member; the owner row has no control.
- **Gated UI**: non-managers don't see create-channel/category or the server gear; they still
  see channels, chat, the members panel (read-only roles), and can Leave.

## Error Handling

- Optimistic send failure → remove pending, restore text, inline error (existing pattern).
- Role change failure (e.g. lost admin mid-action) → RLS denies; surface an inline error in
  the panel; the list reloads to truth.
- A non-manager who somehow triggers a gated write → denied by RLS; UI shouldn't offer it.

## Testing

- **Automated unit test**: extract `canManageRole(actor: { isOwner: boolean; role: "admin"|"member" }): boolean`
  (or similar pure helper) used by the UI gating, and test it (owner→true, admin→true,
  member→false). Keep it pure and small.
- **Backend smoke test** (mirrors prior slices): owner creates a server; a second user joins
  (lands as `member`); the member **cannot** create a channel and **cannot** update a role
  (RLS denies) and **cannot** self-insert as `admin`; the owner promotes the member to
  `admin`; now that user **can** create a channel; the owner cannot be demoted (owner power
  persists regardless of role column).
- **Manual checklist**: two browsers — create server (owner) → other user joins from directory
  (member; no gear, no + buttons) → open Members panel, promote them → they gain the gear/+
  buttons → demote → gated again. Optimistic send shows gray→opaque and reverts on a forced
  failure. Deleting "Our Server" left existing users on the DM home (create/join fresh).

## Done Criteria

- Roles exist and gate channel/category/server management + role management to owner+admins;
  chat stays open to members; self-join can't self-escalate; owner can't be demoted.
- The members panel lists members with roles and lets managers promote/demote.
- "Our Server" is gone; existing users create/join fresh servers.
- Optimistic send shows the gray→opaque effect and reverts on failure.
- New unit test passes; backend smoke test passes; manual checklist passes.

## Roadmap Note

Remaining sub-project #3 slices: moderation (kick/ban/timeout, audit logs) and invite links /
private servers. Then remaining rich-messaging (threads, link previews, non-image files, full
emoji picker). Deployment whenever the user wants it.
