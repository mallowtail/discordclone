# Inter Font + Profile Pictures

**Date:** 2026-06-26
**Status:** Approved design, ready for implementation planning

## Context

The chat app (Foundation + rich messaging + replies/mentions/pins + the Polished Dark
restyle, all merged to `main`) currently uses the device's default UI font and shows **no
avatars anywhere** — `profiles.avatar_url` has existed since the first migration but is
never written or displayed; identity shows as a name (and a 🟢/● glyph).

The user asked for "the Discord font" and uploadable profile pictures with an anonymous
default. **Discord's font is `gg sans` (formerly `Whitney`) — both proprietary and not
legally bundlable.** The agreed substitute is **Inter**, the standard free near-identical
replacement.

A separate, larger request — multi-server support (separating servers from DMs, adding
servers) — is **deferred to its own brainstorm → spec → plan cycle** right after this slice.

## Goal

1. Switch the app's UI font to **Inter** (self-hosted via Next.js).
2. Add **profile pictures**: display avatars (messages + sidebar), an **anonymous-person
   default** for users without one, upload via a small profile dialog, stored in a
   dedicated Storage bucket.

## Scope

### In scope
- **Font:** load Inter with `next/font/google` and wire it to the existing `--font-sans`
  token so the whole app uses it.
- **Avatar display** via a single reusable `Avatar` component:
  - Messages: avatar on the first message of each group; stacked messages get a matching
    left gutter so they align (Discord layout).
  - Sidebar: DM list (other user), user panel (current user); New-DM search results.
  - Default: a gray circle with an anonymous-person silhouette when `avatar_url` is null.
- **Upload:** an `uploadAvatar(file)` helper (reusing existing image validation) that
  uploads to a new `avatars` Storage bucket and returns a public URL; a `ProfileDialog`
  (opened from the user-panel avatar) to upload and set it; `AuthProvider.refreshProfile()`
  so the new picture appears immediately for the uploader.
- **Storage:** a new public-read / authenticated-write `avatars` bucket, image MIME types,
  2 MB limit (created via a dashboard SQL snippet).

### Out of scope (later)
- Multi-server / separating servers from DMs (next sub-project).
- Realtime propagation of avatar changes to *other* users (they see it on next load).
- Other account settings (the dialog is a future home for them, not built now).
- Removing/cropping an avatar, gravatar/initials variants (default is silhouette only).
- Schema changes — `profiles.avatar_url` already exists.

## Technical Decisions

- **Inter via `next/font/google`:** self-hosts the font at build time (no runtime external
  request, no layout shift), and exposes a CSS variable. Wiring that variable into
  `--font-sans` keeps the font centralized like the colors. Rejected: a raw Google Fonts
  `<link>` (runtime request + FOUT).
- **Dedicated `avatars` bucket** (not reusing `attachments`): clean separation of user
  avatars from message images; chosen by the user. Public-read with random filenames, same
  trade-off accepted as `attachments` (unguessable public URLs; fine for a 30-user group).
- **Single `Avatar` component** centralizes the default-silhouette fallback and sizing, so
  every placement is consistent and the default lives in one place.
- **No profile schema change** — display reads/writes the existing `avatar_url`.

## Storage Setup

A new migration-style SQL snippet (run once in the Supabase SQL editor), creating the
bucket and its policies:
- bucket `avatars`: public, `file_size_limit` 2 MB, `allowed_mime_types` =
  png/jpeg/gif/webp.
- `storage.objects` policies: authenticated users may insert into `avatars`; anyone may
  select from `avatars`.

Saved to `supabase/migrations/0004_avatars_bucket.sql` for the repo record (executed
manually, like prior storage setup).

## Components & Files

### New
- `src/components/Avatar.tsx` — `{ url: string | null; name: string; size?: "sm"|"md"|"lg" }`;
  renders the image in a circle, or the anonymous-person SVG on a gray circle when `url` is
  null. (Size maps to fixed px classes.)
- `src/components/ProfileDialog.tsx` — opened from the user-panel avatar; shows the current
  avatar + an "Upload image" button; on pick → `uploadAvatar` → update
  `profiles.avatar_url` for the current user → `refreshProfile()`; inline error on failure.

### Changed
- `src/app/layout.tsx` — load Inter via `next/font/google`, apply its variable on `<html>`.
- `src/app/globals.css` — set `--font-sans` to use the Inter variable (with the existing
  system stack as fallback).
- `src/lib/upload.ts` — add `uploadAvatar(file)` (validate via existing `validateImage`,
  upload to `avatars`, return `{ url } | { error }`).
- `src/components/providers/AuthProvider.tsx` — add `refreshProfile()` to the context (re-
  fetches the current user's profile row); expose it alongside `profile`.
- `src/components/MessageList.tsx` — fetch `avatar_url` alongside names (store a
  `Record<id, { name, avatar_url }>` map); pass the author's avatar to each item.
- `src/components/MessageItem.tsx` — render `Avatar` on the group-header row next to the
  name; add a left gutter so non-header (stacked) messages align under the avatar column.
- `src/components/Sidebar.tsx` — render `Avatar` in the DM list (other user) and the user
  panel (current user); make the user-panel avatar open `ProfileDialog`.
- `src/components/NewDmDialog.tsx` — show `Avatar` next to each search result.

## UX Details

- Default avatar = gray circle + centered person silhouette; uploaded photo replaces it.
- Message avatars appear only on the first message of a group (matching how the name/time
  already show); stacked messages indent to align under the avatar.
- Clicking your avatar in the bottom-left user panel opens `ProfileDialog`; "Upload image"
  picks a file, uploads, and the avatar updates in place.
- Upload constraints surfaced inline (wrong type / too large) using the existing
  `validateImage` messages.

## Error Handling

- Upload failures (type/size/network) → inline error in the dialog; nothing saved.
- A broken/missing `avatar_url` image → the `Avatar` component should fall back to the
  default silhouette if the image fails to load (`onError`), so a bad URL never shows a
  broken-image icon.
- `refreshProfile()` failure leaves the prior profile in place (no crash).

## Testing

- **Automated:** `uploadAvatar` validation is covered by the existing `validateImage` tests
  (reused); add a focused test only if any new pure logic is introduced (e.g. a size-class
  mapper) — otherwise no new unit tests are warranted.
- **Backend smoke test:** sign up, upload an image to the `avatars` bucket, update
  `profiles.avatar_url`, read it back, and confirm the public URL is reachable (mirrors the
  prior storage smoke tests).
- **Manual checklist** (two browsers): app renders in Inter; a user with no avatar shows the
  silhouette in messages + sidebar; upload a picture via the dialog → it appears in your
  messages, DM list, and user panel; the other browser sees it after reload; message avatars
  align correctly with stacked messages; a deliberately bad avatar URL falls back to the
  silhouette.

## Done Criteria

- The app renders in Inter across all screens.
- Avatars show in messages and the sidebar; users without one get the anonymous silhouette;
  uploading via the profile dialog updates your avatar immediately.
- The `avatars` bucket exists with correct policies; the backend smoke test passes.
- `npm run build` and `npm test` pass; the manual checklist passes.

## Roadmap Note

Standalone polish/feature slice. Next up (separate cycle): multi-server support — separating
the server view from DMs and allowing multiple servers (the start of sub-project #3, server
management). Then the rest of that sub-project (roles/permissions, categories, invites,
member list) and remaining rich-messaging features (threads, link previews, non-image
files, full emoji picker).
