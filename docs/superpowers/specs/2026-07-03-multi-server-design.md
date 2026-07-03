# Multi-Server Foundation (Sub-project #3, slice 1)

**Date:** 2026-07-03
**Status:** Approved design, ready for implementation planning

## Context

The chat app currently has **one hardcoded server**: `channels` is a flat, globally
unique list with no `server_id`, **any authenticated user can read every channel**, and
the sidebar hardcodes "🏫 Our Server". DMs already live in separate tables
(`conversations`/`conversation_members`) but are shown mixed into the same sidebar.

This is the first slice of **sub-project #3 (server management)**. It builds the
multi-server foundation: real servers with membership, channels that belong to a server,
membership-based channel access, a Discord-style server rail that separates servers from
DMs, channel **categories**, server/channel/category **creation**, and migration of the
existing hardcoded server. Roles & permissions and full invite management are deferred to
later slices.

## Goal

1. Real **servers** with per-server membership; channels belong to a server.
2. A **server rail** separating servers from DMs (💬 Home = DMs).
3. **Create** a server, **join** any server from an open directory, **leave**.
4. **Categories** grouping a server's channels (collapsible); create channels and
   categories; rename them.
5. Server icons: **initials default** (customizable) with an uploaded-image override.
6. Migrate the existing channels/users into a real "Our Server" with no loss of access.
7. Tighten channel/message access to **server members only**.

## Scope

### In scope
- `servers`, `server_members`, `categories` tables; `channels` gains `server_id` +
  `category_id`; drop the global-unique channel-name constraint; route channels by **id**.
- RLS: membership-based access to channels/messages/categories; open directory of servers;
  self-service join/leave; member-editable servers/channels/categories (no roles yet).
- Server rail (Home + server icons + add), server/DM view split, categorized channel
  sidebar (collapsible), create-server + join-directory dialog, create channel/category,
  rename, server settings (rename + custom icon).
- `serverInitials`/`colorFromName` helpers + `ServerIcon` component; `server-icons` Storage
  bucket + `uploadServerIcon`.
- Migration of the existing server + members + channels into a seeded category.

### Out of scope (later slices of sub-project #3)
- Roles & permissions (everything is member-editable for now).
- Invite links/codes and invite management (open directory instead).
- Member-list panel, server-level moderation (bans/kicks), channel-level permissions.
- Deleting servers, reordering via drag-and-drop, private channels.
- Presence, voice channels.

## Data Model

New migration `supabase/migrations/0005_servers.sql`.

### New tables
- `servers`: `id uuid pk`, `name text not null`, `icon_url text`,
  `owner_id uuid references profiles(id) on delete set null`, `created_at timestamptz`.
- `server_members`: `server_id uuid references servers(id) on delete cascade`,
  `user_id uuid references profiles(id) on delete cascade`,
  `joined_at timestamptz default now()`, primary key `(server_id, user_id)`.
- `categories`: `id uuid pk`, `server_id uuid references servers(id) on delete cascade`,
  `name text not null`, `position int not null default 0`, `created_at timestamptz`.

### `channels` changes
- Add `server_id uuid references servers(id) on delete cascade` (not null after backfill).
- Add `category_id uuid references categories(id) on delete set null` (nullable →
  uncategorized channels render above the first category).
- **Drop** the unique constraint on `channels.name` (names need not be globally unique).
- Keep `name`, `position`.

### Routing change
The channel route currently resolves `/channels/[channelId]` by channel **name** (a v1
quirk). Switch to resolving by the channel **UUID**: the sidebar links use `channel.id`,
and the channel page queries `.eq("id", id)`. The login/root redirect (currently
`/channels/general`) changes to land on the user's default server's first channel by id.

### Migration of the existing server
The `0005` migration, in order:
1. Insert one `servers` row named "Our Server" (`owner_id` null).
2. Insert one `categories` row "Text Channels" in that server.
3. `update channels set server_id = <ourserver>, category_id = <textcat>` for all existing
   channels.
4. `alter table channels alter column server_id set not null`.
5. Insert a `server_members` row for **every existing profile** into "Our Server" (so no
   one loses access to current channels/history).
Messages are untouched (they reference `channel_id`, unchanged).

## Security (RLS)

New security-definer helpers (mirroring `is_conversation_member`, pinned `search_path`):
- `is_server_member(srv uuid)` → is the current user in `server_members` for `srv`.
- `is_channel_member(chan uuid)` → member of the server owning channel `chan`.

Policies (replacing today's "channels readable by any authenticated"):
- `servers`: SELECT to authenticated `using (true)` (open directory); INSERT
  `with check (owner_id = auth.uid())`; UPDATE `using (is_server_member(id))` (rename/icon).
- `server_members`: SELECT `using (is_server_member(server_id))`; INSERT
  `with check (user_id = auth.uid())` (self-join); DELETE `using (user_id = auth.uid())`
  (self-leave).
- `categories`: SELECT/INSERT/UPDATE/DELETE gated on `is_server_member(server_id)`.
- `channels`: SELECT `using (is_server_member(server_id))`; INSERT
  `with check (is_server_member(server_id))`; UPDATE/DELETE `using (is_server_member(server_id))`.
- `messages`: the channel-message SELECT and INSERT policies change from
  `channel_id is not null` to `channel_id is not null and is_channel_member(channel_id)`.
  DM policies unchanged.
- `can_read_message(msg)` (from `0002`, used by reactions) is updated: for a channel
  message, require `is_channel_member(channel_id)` instead of just `channel_id is not null`.
- Realtime: `servers`, `server_members`, `categories`, `channels` added to the
  `supabase_realtime` publication so the rail/sidebar update live (channels/messages already
  broadcast).

**Net effect:** you see a server's channels and messages only if you're a member; anyone
may still join any server via the directory.

## Storage

New `server-icons` bucket (public read, authenticated write, image MIME, 2 MB), created via
`supabase/migrations/0006_server_icons_bucket.sql` (run manually, like `avatars`).
`uploadServerIcon(file)` reuses `validateImage`, uploads to `server-icons`, returns a public
URL; server settings saves it to `servers.icon_url`.

## Components & Files

### New pure logic + components
- `src/lib/server-icon.ts` — `serverInitials(name): string` and
  `colorFromName(name): string` (a stable hex/hsl from a small hash). Unit-tested.
- `src/components/ServerIcon.tsx` — image if `iconUrl`, else initials on `colorFromName`
  background; sizes.
- `src/components/ServerRail.tsx` — Home button + a `ServerIcon` per membership + "+"
  button; highlights the active view.
- `src/components/AddServerDialog.tsx` — tabs: **Create** (name → RPC/insert that seeds
  category + `#general` + membership) and **Join** (lists all `servers`, Join button →
  insert `server_members`).
- `src/components/ServerSettingsDialog.tsx` — rename server + upload custom icon
  (`uploadServerIcon` → update `servers`).
- `src/components/CreateChannelDialog.tsx` / inline category-add — create a channel
  (name + optional category) / create a category, in the current server.
- `src/hooks/useServers.ts` — the current user's servers (with live updates).

### Changed
- `src/lib/upload.ts` — add `uploadServerIcon(file)`.
- `src/components/Sidebar.tsx` — becomes server-aware: given the selected server, render its
  categories (collapsible) + channels (links by id) + add-channel/category affordances +
  the server-settings entry; when Home is selected, render the DM list (its current DM
  behavior). Channel links use `channel.id`.
- `src/app/(app)/layout.tsx` — render `ServerRail` alongside the sidebar; track the selected
  view (a server id or "home"); this is the shell that composes rail + sidebar + page.
- `src/app/(app)/channels/[channelId]/page.tsx` — resolve the channel by **id**; header
  shows the channel; still renders `MessageList`/`MessageInput`.
- `src/app/page.tsx` and the login/register redirects — land on the default server's first
  channel by id (helper to pick it).
- `src/types/db.ts` — add `Server`, `ServerMember`, `Category` types; extend `Channel` with
  `server_id`, `category_id`.

## Server Creation Flow

Creating a server must atomically create the server, a default category, a `#general`
channel, and the owner's membership. To keep this correct under RLS, use a
`create_server(name text)` security-definer function that inserts all four rows (owner =
`auth.uid()`) and returns the new server id. The client calls `supabase.rpc("create_server",
{ name })`, then navigates to the new server's `#general`.

## UX Details

- Rail: 💬 Home (DMs) → divider → server icons → "+". Active view gets a highlight pill.
- Selecting a server shows its categorized channel list; categories collapse/expand
  (client-side state); uncategorized channels render above the first category.
- "+" next to a category / a sidebar affordance opens `CreateChannelDialog`; a separate
  small control adds a category. Rename via an inline edit or the settings dialog.
- Server name header opens `ServerSettingsDialog` (rename + icon), plus a "Leave server"
  action (self-leave; owner can leave too — this is a trusted small group, orphan servers
  are acceptable for now).
- Default landing: the user's first server (e.g. "Our Server") → its first channel.

## Error Handling

- Create/join/leave failures → inline error in the relevant dialog; no partial UI state
  (server creation is atomic via the function).
- A channel/route id that the user can't access (not a member) → the channel query returns
  nothing; show a "Channel not found" state rather than crashing.
- Icon upload failures (type/size) → inline error; nothing saved.
- Empty server/channel/category names → validated client-side before submit.

## Testing

- **Automated unit tests** (`tests/server-icon.test.ts`): `serverInitials` for
  `test`→`TE`, `two words`→`TW`, `three two words`→`TT`, a 1-char name, extra whitespace;
  `colorFromName` returns a stable value for the same input and differs across sample names.
- **Backend smoke test:** user A calls `create_server` (verify server + "general" channel +
  category + A's membership exist and A can read the channel); user B joins from the
  directory and can read it; a **third user who has NOT joined cannot** read that server's
  channels or messages (verifies the RLS tightening); "Our Server" migration left every
  existing member able to read the original channels.
- **Manual checklist:** rail switches between servers and Home/DMs; create a server (lands
  in its #general); join another server from the directory; create a channel + category and
  post in the new channel; rename a server + upload a custom icon (initials show before,
  image after); existing "Our Server" channels + history still work; a logged-in user who
  isn't a member of a server can't see its channels.

## Done Criteria

- Servers, membership, per-server channels, and categories exist; channel access is
  membership-based (non-members can't read).
- The rail separates servers from DMs; create/join/leave, create channel/category, rename,
  and custom/initials icons all work.
- The existing server + members + channels are migrated with no loss of access.
- New unit tests pass; the backend smoke test passes; the manual checklist passes.

## Roadmap Note

Next slices of sub-project #3: roles & permissions, invite links/management, the member-list
panel, server moderation. Also still pending: remaining rich-messaging features (threads,
link previews, non-image files, full emoji picker).
