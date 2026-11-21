# Stickers — design

## Intent

Mallowchat is a Discord-like chat app for a small group of friends (ages ~11–14). Its owner wants
Discord-style **server stickers**: pictures a server's admins upload (friends' faces, inside jokes,
memes) that people send as a message. Discord limits using a server's stickers elsewhere to paid
Nitro; Mallowchat has no paid tier, so **members can send a server's stickers anywhere** — in that
server, other servers, DMs and group chats.

## Goals

- Server admins upload, rename and delete stickers in **Server Settings → Stickers**.
- Anyone in a server can send its stickers anywhere they can send messages.
- Everyone who can see the message sees the sticker — including people in a DM who aren't in the
  sticker's server.
- Deleting a sticker removes it from past messages too ("Sticker removed"), so a bad one can be
  got rid of.
- The database (not just the app) enforces who may add stickers and that you're in the server whose
  sticker you send.

## Non-goals

- KLIPY stickers (the owner said GIFs already cover that), Discord's own sticker packs, Lottie/JSON
  stickers, sticker favorites, stickers inside text, adding a sticker by editing a message.

## Anti-goals (failure even if it "works")

- A DM friend outside the server sees a broken/blank sticker.
- An admin can't make a sticker disappear.
- Someone sends a sticker from a server they're not in (e.g. by crafting a request).

## Approaches (decided with the owner)

1. **Snapshot on the message (chosen).** The message stores its own copy of the sticker: id, name,
   picture URL, size — like GIFs (`messages.gif`). Visible to everyone who can see the message; keeps
   working if the sender leaves the server. Deletion is handled by rewriting the snapshots.
2. Message points at the sticker row (join on read). Tidier, but server-member-only RLS on
   `stickers` would make DM viewers outside the server see nothing unless RLS is loosened.

The owner picked 1.

## Decisions (owner accepted these defaults)

- **Permission:** new role permission **`manage_stickers`** ("Manage Stickers"). The server owner
  always has it (as with other permissions via `has_server_permission`).
- **Files:** PNG, GIF or WebP, animated allowed, **≤ 512 KB**, shown at most **160 px** on its
  longer side.
- **Limit:** **30 stickers per server.**
- **Sending:** a sticker is its **own message** — no text, image, file, GIF or poll with it.
- **Picker:** a **Stickers** tab next to GIFs in the composer, grouped by server (server name +
  icon as the section header), with a search-by-name box. Clicking a sticker sends it.
- **Deleting:** past messages show **"Sticker removed"**; the file is removed from storage.

## Calls made after review (owner to check)

- **Forwarding is allowed for anyone who can see the message**, even if they're not in the
  sticker's server — forwarding shows someone's message, it isn't *using* the sticker (Discord
  works the same way). The "you must be in the server" rule applies to sending a sticker directly.
  Deleting the sticker also turns forwarded copies into "Sticker removed".
- **Roles that already have Manage Server also get Manage Stickers** when this ships, so existing
  admins see the Stickers tab on day one instead of only the owner. Server owners can take it away
  in Roles.

## How it works today (relevant parts)

- Messages: `public.messages` with `content`, `image_url`, `file_url`, `gif jsonb`, `poll`,
  `forward_snapshot`. Constraint `messages_nonempty` (latest in `0036_gifs.sql`) requires something
  in the message. Guards: `guard_message_insert` (0032; spam limit "slow down: too many messages")
  and `guard_message_update` (latest in 0036; only text may change; uses `is_direct_client()`,
  which must run as an invoker function — see the comment in 0032).
- GIFs: `messages.gif` jsonb checked by constraint `messages_gif` (0038); forwarding copies it in
  `0037_forward_gifs.sql` (forward snapshots are built server-side).
- Permissions: `src/lib/servers/permissions.ts` (`PERMISSIONS`, `PERMISSION_LABELS`); the DB has a
  check constraint on `roles.permissions` listing allowed keys (latest in `0018_moderation.sql`
  and any later migration that redefines it — search before changing) and
  `has_server_permission(srv, perm)` (0012).
- Storage: public buckets like `server-icons` (0006). Note those let any authenticated user insert;
  the sticker bucket must be stricter (below).
- Audit log: `audit_log` table (0041) + `src/lib/servers/auditLog.ts` (`describeAuditEntry`).
- Server Settings: `src/components/servers/settings/ServerSettings.tsx`, tabs typed
  `"overview" | "roles" | "members" | "invites" | "bans" | "audit"`, each shown by permission.
- Composer: `src/components/messages/composer/MessageInput.tsx` and `GifPicker.tsx` (has tabs
  `klipy` / `favorites`). Message rendering: `src/components/messages/list/MessageContent.tsx`.
- Image processing: `src/lib/media/imageOptimize.ts` / `imagePlan.ts` (re-encodes, strips EXIF).

## Design

### Database (new migration `0044_stickers.sql`, applied by hand like the others)

- **`stickers`**: `id uuid pk default gen_random_uuid()`, `server_id uuid not null references
  servers on delete cascade`, `name text not null` (2–30 chars after trim, no control characters),
  `path text not null` (storage path), `width int`, `height int` (1–4000), `created_by uuid`
  (references profiles/auth users, `on delete set null`), `created_at timestamptz default now()`.
  Unique `(server_id, lower(name))`.
- **Limit 30 per server**, enforced by a before-insert trigger (with an advisory lock per server so
  two simultaneous uploads can't make 31).
- **RLS:** select — members of the server; insert/update/delete — `has_server_permission(server_id,
  'manage_stickers')`. Update may change `name` only (guard trigger).
- **Permission key:** add `manage_stickers` to the `roles.permissions` check constraint.
- **Storage bucket `stickers`:** public read; `file_size_limit` 524288; mime types `image/png`,
  `image/gif`, `image/webp`. Object path `<server_id>/<sticker_id>.<ext>`. Insert and delete
  policies require `has_server_permission((storage.foldername(name))[1]::uuid, 'manage_stickers')`
  (guard the uuid cast so a junk path is refused, not an error).
- **`messages.sticker jsonb`** shaped `{id, name, url, width, height}`, or `{id, name, removed:
  true}` after deletion. Constraint like `messages_gif`: object; `url` must be this project's
  public URL for the `stickers` bucket; sizes 1–4000; name ≤ 30.
- **Sending is server-authoritative:** on insert, if `sticker` is set, a guard looks the sticker up
  through a SECURITY DEFINER helper that returns the row **only if the caller is a member of its
  server**, refuses otherwise ("you can't use that sticker"), and **overwrites** the snapshot from
  the row (name, URL built from `path`, width, height) — the client only really supplies the id.
  It also requires `content = ''` and no image/file/gif/poll/forward. Fold this into
  `guard_message_insert` or a separate invoker trigger; keep the spam limit applying.
- `messages_nonempty` gains `or sticker is not null`; `guard_message_update` treats `sticker` as
  immutable (re-create it from its latest definition and add the column).
- **Forwarding** copies the sticker snapshot into `forward_snapshot` (follow 0037). The forward
  path keeps its existing `can_read_message` check and does **not** require membership of the
  sticker's server (see "Calls made after review").
- **Backfill:** `update roles set permissions = permissions || 'manage_stickers'` for roles that have
  `manage_server` (after widening the constraint).
- **Deleting a sticker:** an after-delete trigger rewrites every message whose `sticker->>'id'`
  matches to `{id, name, removed: true}`, and the same inside `forward_snapshot->'sticker'`
  (expression indexes on `(sticker->>'id')` and `(forward_snapshot->'sticker'->>'id')` keep that
  cheap). The trigger function is SECURITY DEFINER, which gets it past both `is_direct_client()`
  in `guard_message_update` and the author-only update policy — verify in the dry run. The client
  deletes the storage file through the Storage API after the row is gone.
- **URL check:** the existing own-storage URL helper only accepts flat paths; stickers need their
  own check for `<server_id>/<sticker_id>.<ext>` in the `stickers` bucket.
- **Audit log:** `audit_log.action` has a check constraint and `target_id` refers to profiles, so
  sticker entries need new action values and a place for the sticker's name (e.g. the entry's
  details/reason text) rather than `target_id`.
- **Audit log:** `sticker_create`, `sticker_delete` (and rename if cheap), shown by
  `describeAuditEntry`.
- Dry-run the migration with the usual `begin; … raise exception 'DRYRUN-REPORT:%'` pattern and
  simulated users (member, non-member, manage_stickers holder) before applying.

### App

- `src/lib/servers/permissions.ts`: add `manage_stickers` / "Manage Stickers" (RolesPanel picks it
  up from the list).
- `src/lib/messages/stickers.ts` (pure, unit-tested in `tests/stickers.test.ts`): validate a picked
  file (type, ≤ 512 KB), sticker name rules (2–30, trimmed, matching the DB), display size (fit to
  160 px), normalize a snapshot, and the "Sticker removed" / sidebar preview text.
- **Uploading (Server Settings → Stickers):** grid of the server's stickers with name, rename,
  delete (ConfirmDialog), "12 / 30" counter, and an Upload button (file → name defaults to the file
  name). **Animated GIF/WebP are uploaded as-is** (re-encoding would drop the animation); static
  images may be shrunk to ≤ 320 px with the existing image optimizer, keeping transparency (output
  PNG/WebP, never JPEG). Upload with a short cache time so a deleted sticker stops showing soon. Over 512 KB → plain-language
  error. Tab shown only with `manage_stickers`.
- **Picker:** Stickers tab beside GIFs. Loads stickers for every server you're in (one query; RLS
  limits it), grouped by server with name + icon headers, search box filters by name across all.
  Click sends a sticker message to the current channel/DM; then the picker closes. Empty state:
  "No stickers yet — server admins can add them in Server Settings → Stickers."
- **Rendering (MessageContent):** the image at ≤ 160 px with no bubble/background, `alt`/title =
  sticker name; `removed` (or an image that fails to load) → a small muted "Sticker removed" box.
  Reply previews say "Sticker". (There is no DM-sidebar last-message preview or notification
  feature today; none is added here.)
- Block/ignore hiding, unread, pins and reactions work as for any message.
- Update the AGENTS.md "Where things live" map.

## Left to the builder

- Exact component split and names (e.g. `messages/composer/StickerPicker.tsx`,
  `servers/settings/StickersTab`), styling within the existing design tokens.
- Whether the insert guard is merged into `guard_message_insert` or separate (keep invoker rights
  where `is_direct_client()` is used).
- How stickers are cached client-side (navCache or a small hook).
- Tests: unit tests for the pure lib; a two-browser e2e (upload as admin, send in a server channel
  and in a DM to someone outside the server, they see it; delete → "Sticker removed"; non-member
  crafted insert refused).
