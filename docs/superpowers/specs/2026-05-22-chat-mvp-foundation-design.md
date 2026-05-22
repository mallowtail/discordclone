# Chat Platform — Foundation MVP (Sub-project #1)

**Date:** 2026-05-22
**Status:** Approved design, ready for implementation planning

## Context

This is the first sub-project of a larger Discord-like chat platform intended for a
small private group (~30 friends from school). Because the full feature set spans
many independent subsystems, it has been decomposed into sequential sub-projects.
This document specifies **only the Foundation MVP** — the thin vertical slice that
proves the whole thing works end-to-end. The remaining sub-projects are listed at
the end for context but are explicitly out of scope here.

The builder is newer to web development, so the design deliberately favors managed
services and the smallest amount of custom backend code that gets to a working,
deployed app.

## Goal

A working, deployed chat app where group members can:

1. Register and log in.
2. Open one shared server that already exists, with a few text channels.
3. Send and read messages in those channels, updating live for everyone.
4. Send and read 1-on-1 direct messages, also live.

## Scope

### In scope
- Email + password authentication (register, log in, log out).
- A user profile row (username, display name, avatar URL) created on registration.
- One pre-existing shared server with a small set of seeded text channels.
- Real-time messaging in channels.
- 1-on-1 direct messages, real-time.
- Basic error handling and a small automated + manual test suite.
- Deployment to a free hosting tier.

### Out of scope (later sub-projects)
- Creating/managing servers and channels from the UI.
- Roles, permissions, member lists, presence indicators.
- Message editing/deletion, reactions, threads, markdown, file/image upload, link previews.
- Group DMs (the data model supports them, but no UI in v1).
- Voice/video, screen share.
- Federated login (Google etc.) and MFA.
- The school-privacy "cloaking" features and the advanced security/moderation tooling.
- Any scaling infrastructure (load balancing, reverse proxy, pub/sub clustering) — unnecessary at ~30 users.

## Stack

| Concern | Choice | Why |
|---|---|---|
| Frontend | **Next.js** (React) | Approachable, huge ecosystem, deploys free. |
| Auth | **Supabase Auth** (email/password) | Built-in; federated + MFA available later by config. |
| Database | **Supabase Postgres** | Relational model fits the full roadmap (servers, roles, members). |
| Real-time | **Supabase Realtime** | Live message delivery over websockets with no custom server. |
| File storage | **Supabase Storage** | Ready for avatars/uploads in later sub-projects. |
| Frontend hosting | **Vercel** (free tier) | Git-push deploys. |
| Cost | **$0** | Free tiers are far more than enough for ~30 users. |

**Prerequisite:** Node.js (LTS) installed inside WSL via nvm. (Installed during
brainstorming: node v24.16.0.)

## UI Layout

Simplified two-pane layout (no server rail, no member list in v1):

- **Left sidebar:** server name header; list of text channels; a "Direct Messages"
  section listing 1-on-1 conversations; a small current-user panel at the bottom.
- **Main pane:** channel/DM header, scrollable message list, message input box.

The full three-pane Discord look (server rail + member list) is deferred to the
sub-projects that introduce multi-server and roles/presence, since that chrome only
earns its keep once those features exist.

## Data Model

Five tables in Postgres.

### `profiles`
Public per-user info; 1:1 with Supabase's `auth.users`.
- `id` (uuid, PK, references `auth.users.id`)
- `username` (text, unique)
- `display_name` (text)
- `avatar_url` (text, nullable)
- `created_at` (timestamp)

### `channels`
Text channels in the single shared server.
- `id` (uuid, PK)
- `name` (text)
- `position` (int) — display order
- `created_at` (timestamp)

### `conversations`
A DM thread (and, later, group DM).
- `id` (uuid, PK)
- `is_group` (bool, default false)
- `created_at` (timestamp)

### `conversation_members`
Who is in a conversation.
- `conversation_id` (uuid, references `conversations`)
- `user_id` (uuid, references `profiles`)
- (primary key is the pair)

### `messages`
Every message. Each row belongs to **either** a channel **or** a conversation —
exactly one of the two foreign keys is set.
- `id` (uuid, PK)
- `author_id` (uuid, references `profiles`)
- `channel_id` (uuid, references `channels`, nullable)
- `conversation_id` (uuid, references `conversations`, nullable)
- `content` (text)
- `created_at` (timestamp)

A database constraint enforces that exactly one of `channel_id` /
`conversation_id` is non-null.

### Row Level Security (RLS)
Because the client talks to the database directly, RLS policies are the access
control layer and must be enabled on every table:

- `profiles`: readable by any authenticated user; a user may update only their own row.
- `channels`: readable by any authenticated user; no client writes (seeded server-side).
- `conversations` / `conversation_members`: readable only by members of that conversation.
- `messages`:
  - Channel messages (`channel_id` set): readable by any authenticated user.
  - DM messages (`conversation_id` set): readable only by members of that conversation.
  - Insert allowed only when `author_id` equals the current user **and** the user is
    permitted in the target channel/conversation.

## Real-Time Data Flow

Sending a message:
1. User submits text in the browser.
2. App inserts one row into `messages` via the Supabase client.
3. RLS verifies the user may post to that target.
4. Row is stored in Postgres.

Delivery (automatic):
5. Supabase Realtime detects the insert and broadcasts it over websockets.
6. Every client subscribed to that channel/conversation receives the row and appends
   it to the message list — no refresh.

Per screen, the app implements just two interactions: insert-on-send, and
subscribe-to-new-messages-on-open. Supabase manages websockets, broadcast, and
reconnection.

## Auth

- Supabase Auth with email + password.
- On registration, after the auth user is created, insert a matching `profiles` row
  with the chosen username.
- Two app zones: logged-out (login/register pages) and logged-in (the chat). A route
  guard redirects unauthenticated users to login.
- Federated providers and MFA are deferred; they are configuration additions in a
  later sub-project.

## Error Handling

- **Message send failure / network blip:** show the message optimistically as
  "sending…"; on failure surface a retry affordance.
- **Realtime disconnect:** Supabase auto-reconnects; on reconnect, re-fetch recent
  messages for the open channel/DM so nothing is missed.
- **Form/auth errors** (username taken, wrong credentials): inline, human-readable
  messages; never crash.

## Testing

- **Automated unit tests** on pure logic only (message validation, any formatting
  helpers).
- **Manual test checklist** for the integration flows:
  register → log in → post in `#general` → confirm it appears on a second browser →
  open a DM → send and receive a message → log out.
- No end-to-end browser automation in v1 (overkill at this stage).

## Deployment

- Frontend on Vercel (free), connected to the project's git repo for push-to-deploy.
- Backend is fully managed by Supabase (database, auth, realtime, storage).

## Full Roadmap (context only — not this sub-project)

1. **Foundation (this spec)** — auth, one server, text channels, real-time messages, DMs.
2. Rich messaging — edit/delete, markdown, reactions, replies/threads, mentions, pins, image & file upload, link previews.
3. Server management — roles & permissions (RBAC), categories, invite links, member list, server settings.
4. DMs & friends — friends tab, group chats, presence indicators.
5. Voice & video — voice channels, screen share, push-to-talk, mute/deafen (via LiveKit).
6. School privacy mode — tab/favicon/name cloak, panic-redirect keybind, blur on focus loss, fake 404.
7. Security & moderation — MFA, rate limiting, audit logs, bans/kicks/timeouts, report system.
8. Profile & account settings.
