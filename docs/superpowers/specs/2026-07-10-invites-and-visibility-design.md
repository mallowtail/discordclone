# Invites & public/private servers — design

**Date:** 2026-07-10
**Sub-project:** #3 (server management) — invites slice
**Status:** approved, ready for planning

## Goal

Add a per-server **public/private** visibility model and **invite links** so members
can bring friends into private servers. Today every server is publicly listed and
anyone can join anything (open directory, `servers` SELECT policy is `using (true)`).

## Decisions (from brainstorming)

- **Join model:** Hybrid. Each server is either **public** (listed in the directory,
  anyone joins) or **private** (hidden, invite-only). Managers toggle it per server.
- **Invite links:** One simple reusable code per server (10 hex chars). No expiry, no
  max-uses. Regenerating kills the old link.
- **Permissions:** Any **member** can view and copy the invite link to share it. Only
  **managers** (owner + admins, i.e. `is_server_admin`) can regenerate it.
- **Accept flow:** A confirmation page (server icon + name + member count + "Join
  Server"). Logged-out visitors are sent to login/register and returned to the page.

## Data model — `supabase/migrations/0008_invites.sql`

Two columns on `public.servers`:

- `is_public boolean not null default true` — existing servers stay public.
- `invite_code text unique` — short random code. Backfilled for existing rows; set for
  new servers.

Code generation (SQL, no extension needed):
`substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)`.

### RLS changes (security-critical)

- **Replace** `"servers readable by authenticated" ... using (true)` with a policy that
  reads only public-or-member servers:
  `using (is_public or public.is_server_member(id))`.
  This is what actually hides private servers from the directory and from snooping.
- **Tighten self-join** (`"self join server"` on `server_members`): direct inserts are
  allowed only for **public** servers:
  `with check (user_id = auth.uid() and role = 'member' and exists (select 1 from public.servers s where s.id = server_id and s.is_public))`.
  Private servers can only be joined through `join_via_invite`.
- Toggling `is_public` uses the existing `"admins update server"` UPDATE policy
  (`is_server_admin(id)`) — no new policy needed.

### RPCs (SECURITY DEFINER, `set search_path = public`)

- `server_by_invite(code text)` → `table(id uuid, name text, icon_url text, member_count bigint)`.
  Powers the invite **preview** page for someone who is not yet a member of a private
  server (they can't SELECT the row directly). Returns no rows if the code is unknown.
- `join_via_invite(code text)` → `uuid` (the joined server id). Looks up the server by
  `invite_code`; inserts `(server_id, auth.uid(), 'member')` if not already a member;
  returns the server id. Raises an exception if the code is invalid.
- `regenerate_invite(srv uuid)` → `text` (the new code). Guards on
  `is_server_admin(srv)` (raises otherwise); sets a fresh `invite_code`; returns it.

`create_server` is updated to set `invite_code` on the new row.

## Types — `src/types/db.ts`

`Server` gains `is_public: boolean` and `invite_code: string | null`.

## UI

- **InviteDialog** (`src/components/servers/InviteDialog.tsx`) — reachable by **any**
  member from the server header. Shows the invite link (built from `invite_code`) with a
  **Copy** button. Managers additionally see a **Regenerate** button (calls
  `regenerate_invite`, updates the shown link). Read `invite_code` from the already-loaded
  server row.
- **ServerSettingsDialog** (managers section) — add a **Public / Private** toggle that
  writes `is_public` via a normal `update`.
- **Invite accept page** (`src/app/invite/[code]/page.tsx`) — a public route **outside**
  the `(app)` route group (no server chrome). Calls `server_by_invite(code)`:
  - Unknown code → "This invite is invalid or expired."
  - Logged out → redirect to `/login?next=/invite/<code>`.
  - Already a member → button reads **Open** and routes into the server.
  - Otherwise → **Join Server** calls `join_via_invite(code)` then routes to
    `/channels/first?server=<id>`.
- **Directory** (`AddServerDialog` Join tab) — no logic change; the new SELECT policy
  makes it list only public servers automatically. Relabel the tab/heading "Public
  servers" for honesty.
- **login + register** — honor a `?next=` query param and redirect there after auth
  (register currently hardcodes `/channels/first`). The register link should carry `next`
  through so the invite round-trip survives a sign-up.

## Edge cases

- Already a member opens an invite → **Open**, no duplicate insert.
- Invite to an otherwise-invisible private server → the preview RPC still returns basic
  info; joining flips the visitor to member so the row becomes visible thereafter.
- Invite-code collision on regenerate → the `unique` constraint errors the RPC. At 10
  hex chars this is astronomically unlikely; no retry loop (YAGNI).

## Testing

- **Unit** (`src/lib/invite.ts` + `tests/invite.test.ts`): a pure `inviteUrl(code)`
  builder (e.g. `${origin}/invite/${code}`) with a couple of tests.
- **Backend smoke test** (multi-user RLS, the real safety net):
  1. Non-member **cannot** SELECT a private server row (directory hides it).
  2. Non-member **can** read it via `server_by_invite`.
  3. Direct self-join insert to a private server is **blocked**.
  4. `join_via_invite` with a valid code **works**; an invalid code **errors**.
  5. `regenerate_invite` **fails** as a member, **succeeds** as an admin, and the old
     code **stops working** afterward.
  6. Public directory-join still works.

## Operational note

`0008_invites.sql` must be run in the Supabase SQL editor before the live app works
(same pattern as every prior schema slice).
