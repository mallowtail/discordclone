# Rich Messaging — Sub-project #2 (Tier A + image upload)

**Date:** 2026-06-05
**Status:** Approved design, ready for implementation planning

## Context

This is the second sub-project of the chat platform (a Discord-like app for ~30
school friends). Sub-project #1 (Foundation MVP) shipped auth, one shared server
with text channels, realtime messaging, and 1-on-1 DMs on Next.js 16 + Supabase,
and is merged to `main`. See `2026-05-22-chat-mvp-foundation-design.md`.

"Rich messaging" in the roadmap spans eight independent features (edit/delete,
markdown, reactions, replies, mentions, pins, threads, file upload, link previews).
That is too large for one spec, so it was decomposed into tiers. **This spec covers
the next slice only:** edit, delete, markdown, reactions, and inline image upload.
The remaining rich-messaging features (replies, mentions, pins, threads, link
previews, non-image files) are deferred to later slices.

The builder is newer to web development, so the design favors managed services,
safe-by-default libraries, and the smallest amount of custom code that works.

## Goal

Make messages richer to use:

1. Authors can **edit** and **delete** their own messages.
2. Messages render **Discord-style markdown**.
3. Anyone can add **emoji reactions** from a fixed set, shown as live-updating pills.
4. Anyone can upload an **image** that displays inline in the chat.

## Scope

### In scope
- Edit own message (inline edit; sets `updated_at`; shows an "(edited)" marker).
- Delete own message (hard delete — the row is removed).
- Markdown rendering: bold, italic, strikethrough, inline code, code blocks,
  blockquotes, and clickable links (open in a new tab). Everything else renders
  as plain text.
- Reactions: a fixed emoji set (👍 ❤️ 😂 🎉 😮 😢), one row per (message, user,
  emoji), toggled on/off, live via realtime, shown as pills with counts and a
  highlight for the current user's own reactions.
- Image upload: images only (png/jpg/gif/webp), max 5 MB, stored in Supabase
  Storage, displayed inline; an image-only message (no text) is allowed.

### Out of scope (later slices / sub-projects)
- Editing/deleting *other people's* messages (moderation belongs to the
  roles/permissions sub-project #3).
- Full emoji picker (fixed set only for now).
- Non-image file uploads, full markdown (headings/tables/etc.), replies, mentions,
  pins, threads, link previews/unfurling.
- Edit history (only the latest version is kept).

## Technical Decisions

- **Markdown rendering:** use the `react-markdown` library, restricted to the
  subset above. It renders without dangerous HTML injection (no
  `dangerouslySetInnerHTML`), avoiding XSS. `remark-gfm` enables strikethrough.
  Disallowed constructs fall back to plain text. Rejected: hand-written parser
  (reinvents escaping/sanitization, easy to get unsafe).
- **Reactions storage:** a `reactions` table keyed on (message_id, user_id, emoji).
- **Image storage:** an `image_url` column on `messages` (one image per message),
  rather than a separate attachments table — fits "images inline" and is simpler.
- **Image privacy:** a public-read Storage bucket with random UUID filenames.
  Trade-off accepted: someone with an exact image URL could view it, but URLs are
  unguessable; appropriate for a 30-person private group. Rejected for this slice:
  signed URLs / private bucket (more complexity).

## Database Changes

New migration: `supabase/migrations/0002_rich_messaging.sql`.

### `messages` table — alterations
- Add `updated_at timestamptz` (nullable; set to `now()` on edit).
- Add `image_url text` (nullable).
- Drop the existing `content` length check and replace with:
  - `char_length(content) <= 2000`, and
  - a "non-empty message" check: `char_length(content) > 0 OR image_url is not null`.

### `reactions` table — new
- `message_id uuid not null references public.messages(id) on delete cascade`
- `user_id uuid not null references public.profiles(id) on delete cascade`
- `emoji text not null`
- `created_at timestamptz not null default now()`
- Primary key: `(message_id, user_id, emoji)` (prevents duplicate reactions).
- Index on `(message_id)` for fast per-message lookups.

### Helper function — `can_read_message(msg uuid)`
Mirrors the existing `is_conversation_member` pattern (`security definer`, pinned
`search_path`). Returns true when the current user may read the given message:
the message is a channel message (readable by any authenticated user), OR it is a
DM message in a conversation the user belongs to. Used by reaction RLS.

### RLS policies
- `messages` — add:
  - **UPDATE**: `using (author_id = auth.uid())` with
    `with check (author_id = auth.uid())` (author edits only their own; cannot
    change authorship).
  - **DELETE**: `using (author_id = auth.uid())`.
- `reactions` — enable RLS and add:
  - **SELECT**: `using (public.can_read_message(message_id))`.
  - **INSERT**: `with check (user_id = auth.uid() and public.can_read_message(message_id))`.
  - **DELETE**: `using (user_id = auth.uid())`.
- Realtime: `alter publication supabase_realtime add table public.reactions;`

### Live DB note
The existing live database already has the `0001` schema. The `0002` migration
must be run once in the Supabase SQL editor (same process as `0001`). It also
needs the channels-name unique constraint that was added to the canonical `0001`
file after the live DB was created — if not already applied, include
`alter table public.channels add constraint channels_name_unique unique (name);`
guarded so it does not error if present. (Channels are seed-only, so low risk.)

## Storage Setup

- One bucket: `attachments`, **public** read.
- Allowed uploads: image MIME types only; 5 MB limit (enforced client-side in
  `lib/upload.ts` and by the bucket's file-size limit).
- Files stored under a random UUID path (e.g. `<uuid>.<ext>`).
- Bucket creation + policies are a manual dashboard/SQL step documented in the plan
  (Storage RLS: authenticated users may upload; anyone may read).

## Realtime Changes

`src/hooks/useMessages.ts` currently subscribes only to message INSERTs. Extend it:
- **UPDATE** events → replace the matching message in local state (handles edits).
- **DELETE** events → remove the matching message from local state.
- Keep the existing reconnect-reload + de-dupe behavior.

Reactions use a separate hook, `src/hooks/useReactions.ts`, subscribed to the
`reactions` table filtered to the current channel/DM's messages, returning an
aggregated structure (per message: each emoji with its count and whether the
current user reacted). On reconnect it reloads, mirroring `useMessages`.

## Components & Files

### New
- `src/components/MessageContent.tsx` — renders markdown (via `react-markdown` +
  `remark-gfm`, restricted subset) and, if present, the inline image and the
  "(edited)" marker.
- `src/components/MessageActions.tsx` — hover action row for the author's own
  messages (edit, delete) with a confirm on delete.
- `src/components/ReactionBar.tsx` — reaction pills (emoji + count, own-reaction
  highlight, click to toggle) and the fixed-set add-reaction picker on hover.
- `src/hooks/useReactions.ts` — realtime reactions for the open channel/DM.
- `src/lib/upload.ts` — pure image validation (type + size) and the Storage upload
  helper returning the public URL.
- `src/lib/reactions.ts` — pure helper that aggregates reaction rows into
  pills (emoji → { count, mine }) for a message.

### Changed
- `src/components/MessageItem.tsx` — compose `MessageContent`, `MessageActions`,
  and `ReactionBar`; add inline-edit mode (textarea, Enter saves / Esc cancels,
  reuses `validateMessage`).
- `src/components/MessageInput.tsx` — add the 📎 attach button + upload flow
  (uploading state, inline error like the existing send-error pattern).
- `src/hooks/useMessages.ts` — handle UPDATE and DELETE realtime events.
- `src/types/db.ts` — add `updated_at` and `image_url` to `Message`; add a
  `Reaction` type.

## UX Details

- **Editing:** hovering your own message reveals ✏️/🗑️. Edit replaces content with
  an inline textarea; Enter saves, Esc cancels; empty edit is rejected unless an
  image is attached. After save, "(edited)" appears.
- **Deleting:** 🗑️ prompts "Delete this message?"; on confirm the row is deleted
  and disappears for everyone (realtime DELETE).
- **Reacting:** an add-reaction affordance appears on hover for any message.
  Reaction pills sit just below the message; clicking a pill toggles your reaction.
- **Images:** 📎 in the composer opens a file picker (images only). The image
  uploads, then a message is sent carrying the `image_url` plus any typed text.
  The image renders inline (size-capped; click opens full size in a new tab).
- Message grouping (from sub-project #1) is unaffected: reactions/edited markers
  attach to individual messages within a group.

## Error Handling

- **Upload failures** (too big, wrong type, network): block the send and show an
  inline message; the typed text is preserved.
- **Edit/delete failures:** surface an inline error; on edit failure keep the
  draft in the textarea so it can be retried.
- **Reaction failures:** the optimistic toggle reverts if the write fails.
- RLS rejections (e.g. editing a message that isn't yours) cannot happen through
  the UI (actions are author-gated client-side) and are also denied by the
  database as defense in depth.

## Testing

- **Automated unit tests** (pure logic only):
  - `lib/upload.ts` — image validation accepts allowed types ≤5 MB; rejects wrong
    type and oversize.
  - `lib/reactions.ts` — aggregation turns rows into the correct
    per-emoji counts and `mine` flags.
- **Manual checklist** (interactive/realtime):
  edit a message (see "(edited)" update on a second browser) → delete a message
  (disappears on both) → add/remove reactions (counts update live) → upload an
  image (renders inline on both) → markdown formatting renders correctly →
  image-only message (no text) sends.
- No end-to-end browser automation (consistent with sub-project #1).

## Done Criteria

- Authors can edit and delete their own messages; changes propagate live.
- Messages render the Discord-style markdown subset safely.
- Emoji reactions can be toggled and update live as pills with counts.
- Images upload (≤5 MB, images only) and display inline; image-only messages work.
- New unit tests pass; the slice is verified via the manual checklist and a backend
  smoke test of the new RLS policies (edit/delete/react), mirroring sub-project #1.

## Roadmap Position

Sub-project #2 of 8. Remaining after this slice: the rest of rich messaging
(replies, mentions, pins, threads, link previews, non-image files), then #3 server
management (roles/permissions, categories, invites, member list), #4 DMs & friends,
#5 voice/video, #6 school privacy mode, #7 security & moderation, #8 profile &
account settings.
