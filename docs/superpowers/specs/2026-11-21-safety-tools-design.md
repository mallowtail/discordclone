# Safety tools — design (reports, site admin, site-wide bans)

## Intent

Part of "finishing the website" (roadmap: accounts ✓ → **safety tools** → free-plan limits →
polish → threads). Mallowchat is a Discord-like chat app for a small group of friends (~11–14).
Today moderation exists only inside servers (kick/ban/timeout/delete messages) and nobody is a
site-wide admin; DMs and groups have only block/ignore. The owner wants people to be able to
**report** bad messages and users, wants **server moderators and themself** to see those reports,
and wants **site-admin powers** to deal with real trouble.

## Goals

- **Report message** — in the "…" More menu on a message (`MessageActions`, desktop hover menu and
  the phone long-press menu). **Report user** — in a person's profile "⋯" menu (`SafetyMenu`, next
  to Ignore/Block). **Report server** — in the server's menu; goes only to the site admin.
- Report form: reason (Spam · Harassment or bullying · Inappropriate content · Hate speech ·
  Something else) + optional note (≤ 500 chars). A message report stores a **snapshot** of the
  message (author, text, attachments/GIF/sticker URLs, where it was) so deleting the message doesn't
  remove the evidence.
- **Who sees reports:**
  - Reports about something in a server (a message in one of its channels) → that server's
    moderators = holders of the new **"View Reports"** role permission (`view_reports`; the owner
    always has it) **and** the site admin.
  - Reports from DMs/groups, user reports, and server reports → **only the site admin**.
  - The reported person never sees who reported them. Moderators and the admin see the reporter.
- **Server Settings → Reports** tab (shown with `view_reports`): open/handled lists, open count;
  per report: jump to the message, delete it, open the reported user's moderation menu (existing
  timeout/kick/ban), mark handled (with an optional note).
- **Site admin** (the owner's own account): an **Admin** button next to their name in the user
  panel, visible only to them, opening `/admin`:
  - **Reports** from everywhere (same actions as moderators, across all servers/DMs).
  - **Site-wide ban:** the person can't use Mallowchat (login refused; anything open stops working);
    their messages stay unless "Also delete all their messages" is ticked; for each server they own
    the admin picks a member to hand it to, or deletes the server (never leave a server ownerless);
    they can be **unbanned** later and come back as they were; their login page says the account is
    banned (no reporter info).
  - **Delete any message or uploaded file** anywhere; **delete any server**.
  - Users list with search (to find someone to ban/unban).

## Non-goals

- Email notifications for reports (no email provider). Automatic content filtering. Reports to the
  reported person. Appeals. Multiple site admins (one is enough; the table allows more later).

## Anti-goals

- Anyone other than the owner can become site admin (from the app, by any request).
- A moderator sees reports from another server, or from DMs/groups.
- A banned person keeps posting, joining, or calling.
- Banning someone leaves a server without an owner.
- Reporting becomes a spam tool (e.g. hundreds of reports a minute).

## Calls made after review (owner to check)

1. **Reports about a moderator go to the site admin only.** If the reported person (message author,
   or reported user) has View Reports in that server — including the owner — the report is visible
   only to the site admin, so a moderator never sees a report about themself or who sent it.
2. **Manage Messages finally lets moderators delete other people's messages** (it doesn't today:
   the only delete rule is "delete own messages"). Holders of `manage_messages` get Delete on
   anyone's messages in that server's channels — in chat and from the Reports tab — like Discord.
   Each such deletion is written to the server's audit log ("deleted a message by X").
3. **A ban takes effect right away for everything that matters:** writes are refused immediately
   (live-account guards), their sessions are logged out (no token refresh), their open app signs
   itself out on its next check (as deleted accounts do), and they are **removed from any voice call**
   — a small server route (`/api/admin/ban-voice` or similar) that checks the caller is site admin
   and uses the LiveKit secret already on Vercel to remove their participant from every room. Until
   their current login token expires (≤ 1 hour) an already-open page could still read what it already
   had access to; that's accepted.
4. **The admin acts on what's reported** (plus places the admin is already in). No browsing of
   private DMs or a storage browser — privacy for everyone else. "Delete any message or file" means
   any reported message and its attachments, from the admin page.
5. **"Also delete all their messages"** removes every message they wrote — servers, DMs and groups —
   and the files attached to those messages. Their avatar stays (they come back as they were on
   unban); stickers they uploaded belong to the server and stay.
6. **While banned, everyone else sees them as "Deleted User"** (grey avatar, no name, profile card
   "This account was deleted.", no DM/friend/call actions — the same display as a deleted account),
   **but nothing about them is erased**: their profile, messages (unless "Also delete all their
   messages" was ticked) and files stay in the database as a record, in case they did something
   really bad that should be documented (owner's decision). The admin page shows their real identity.
   On unban they come back exactly as before. **Group chats they own pass to a random member** when
   they're banned (no ownerless groups); servers are handed off or deleted by the admin as designed.
   Implementation: a public `profiles.banned_at` (set/cleared only by `site_ban`/`site_unban`) that the
   app treats like `deleted_at` for display; the admin's views ignore it. (Raw API reads of the
   profile still return the stored fields — accepted for this app; the app never shows them.)

## Approaches (owner left the how to Claude; Claude chose A)

- **A. All inside the database (chosen).** Admin powers are SECURITY DEFINER functions that check
  `is_site_admin()`; the site admin is a row in a `site_admins` table that no app request can write
  (only migrations / the Management API). Site bans are recorded in the database and enforced both by
  Supabase Auth (`auth.users.banned_until` far in the future → login and token refresh refused) and by
  the existing live-account guards (0047's `is_live_account()` also returns false for banned users,
  so a still-valid token can't act). No new secrets on Vercel.
- B. A server route using the service-role key in Vercel. Rejected: puts an all-powerful key on the
  web server; if it leaked, the whole database is open.

## How it works today (relevant facts)

- Permissions: `src/lib/servers/permissions.ts` (`PERMISSIONS`, labels); DB constraint
  `roles_valid_permissions` and owner array in `my_permissions` (newest in 0050); owners pass
  `has_server_permission` always. New permissions so far were backfilled onto roles with
  `manage_server`.
- Live-account guards: 0047 `is_live_account()` / `require_live_account()` used by every write path
  (servers, joins, messages, reactions, polls, pins, friend requests, DMs, groups, calls, …); 0046
  tombstones; voice token route checks `is_live_account` (fix wave).
- Message menu: `src/components/messages/list/MessageActions.tsx` (More menu: Pin, Edit, Delete).
  Profile menu: `src/components/user/profile/SafetyMenu.tsx` (Ignore/Block). Server Settings tabs:
  `src/components/servers/settings/ServerSettings.tsx` (`Tab` union). User panel:
  `src/components/user/profile/UserPanel.tsx`. Routes under `src/app/(app)/`.
- Moderation RPCs exist (kick/ban/timeout with reasons, 0018/0041) and the audit log (0041+).
- Storage buckets: attachments, avatars, server-icons (per-server folders, 0050), stickers.
- Production has 3 real accounts; the owner's account is the one with their Gmail address.

## Design

### Database (new migration)

- `site_admins(user_id uuid primary key references profiles)`; RLS on, **no** write policies; a
  select policy only for the admin themself. `is_site_admin()` SECURITY DEFINER stable. Seed the
  owner's account (look up by their email in `auth.users`) in the migration — or a separate one-off
  statement — never from the app.
- `view_reports` permission: constraint + owner array + `PERMISSIONS` + label "View Reports";
  backfill onto roles with `manage_server`.
- `reports`: id, reporter_id, kind (`message` | `user` | `server`), message_id (nullable, no FK so
  deleting the message keeps the report), target_user_id, server_id (nullable; set for messages in a
  server channel and for server reports), conversation_id (nullable), snapshot jsonb (message
  snapshot), reason (enum of the five), note (≤ 500), status (`open` | `handled`), handled_by,
  handled_note (≤ 500), handled_at, created_at.
  - Insert only through `create_report(...)` (SECURITY DEFINER): caller must be live
    (`require_live_account`), must be able to see the message (existing `can_read_message`) or the
    user/server; builds the snapshot server-side; derives server_id/conversation_id; rate limit
    (e.g. ≤ 10 reports per 10 minutes per reporter, and one open report per reporter per target).
  - Select: site admin all; `view_reports` holders of `server_id` for `kind = 'message'` rows of
    their server (not server reports, not DM/group reports). Reporters may see their own reports'
    existence (optional — builder's call).
  - Update (mark handled) through `handle_report(id, note)`: site admin, or `view_reports` holder of
    that row's server.
- **Site bans:** `site_bans(user_id pk, banned_by, reason, created_at)`.
  `site_ban(user, delete_messages bool, reason)` (admin only): refuses while the user still owns any
  server (the admin must hand off or delete first — UI does it per server via
  `admin_transfer_server` / `admin_delete_server`); sets `auth.users.banned_until` to a far-future
  date; optionally deletes all their messages; logs out their sessions (delete their
  `auth.sessions` / refresh tokens). `site_unban(user)` clears both. `is_live_account()` also
  returns false while a `site_bans` row exists. Can't ban yourself or another site admin.
- **Admin deletes:** `admin_delete_message(id)`, `admin_delete_server(id)`,
  `admin_transfer_server(srv, new_owner)` (new owner must be a live member), and storage delete
  policies letting the site admin delete any object in any bucket.
- **Moderator message delete:** `delete_message_as_mod(id)` (SECURITY DEFINER): caller has
  `manage_messages` in the message's server (channel messages only); deletes it and writes an audit
  row `message_delete` (widen the audit action check; store the author as `target_id`). The app shows
  Delete on others' messages for those holders (MessageActions) and in the Reports tab.
- **Reports about moderators:** `create_report` checks whether the reported person holds
  `view_reports` in the server; if so it records the report with `server_id` kept for context but
  flagged `admin_only = true`, and the moderator read rule excludes `admin_only` rows.
- **Ban side effects:** `site_ban` also passes ownership of each group the person owns to a random
  member (reuse the 0046 `leave_group_as`-style logic without removing them), deletes their
  `auth.sessions`/refresh tokens, and (if asked) deletes their messages + those messages' storage
  files (attachments). Voice removal is the app route described in "Calls made after review" #3.

### App

- **Report dialog** (`messages/…` or `ui/ReportDialog`): reason radio list + note + Send; success
  "Thanks — the moderators will take a look." Friendly errors for the rate limit ("You've sent a lot
  of reports — try again in a few minutes") and duplicates ("You already reported this").
- **Report message** in MessageActions' More menu (not on your own messages). **Report user** in
  SafetyMenu (not for yourself or deleted users). **Report server** in the server menu (not for
  owners).
- **Server Settings → Reports** tab (with `view_reports`), with an open-count badge; each report
  shows reason, note, reporter, when, the snapshot (rendered like a message, images included), and
  actions: Jump to message (if it still exists), Delete message (if the viewer has
  manage_messages), Moderate user (opens the existing member mod menu), Mark handled (+ note).
- **`/admin`** (route under `(app)`; renders "Not found" for anyone who isn't site admin — the data
  is protected by the database anyway): tabs Reports · Users · Servers.
  - Reports: all open/handled reports, same cards + admin actions (delete message anywhere, site-ban
    the author).
  - Users: search by username/display name; each row: Ban / Unban. Ban dialog: reason, "Also delete
    all their messages", and a step listing servers they own with "Give to…" (member picker) or
    "Delete server" for each; Ban enabled once none remain.
  - Servers: search; Delete server (type-name confirm).
- **Admin button** in UserPanel for the site admin (check `is_site_admin()` once, cache it).
- **Banned login:** when Supabase refuses login because the user is banned, the login page says
  "This account has been banned from Mallowchat." Signed-in banned users (token still valid) are
  signed out (like the deleted-account path in AuthProvider).

## Left to the builder

- Exact component split, styles within existing tokens, how report cards render the snapshot (reuse
  message rendering where practical).
- Rate-limit numbers within the spirit above; exact RLS shape.
- Tests: unit tests for new pure logic; a dry run proving the anti-goals (non-admin can't become
  admin or call admin functions; moderator of server A can't see server B's or DM reports; banned
  user's token can't write; ban refused while owning a server; snapshot survives message deletion);
  a browser test of report → moderator sees it → handles it, and admin ban/unban. Temp accounts via
  the admin API; Supabase CAPTCHA is ON, so browser logins need another way (e.g. admin
  generate_link → session), as the icon-permission task did.
