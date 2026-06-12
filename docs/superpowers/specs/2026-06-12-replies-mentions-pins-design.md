# Replies, Mentions & Pins — Sub-project #2, slice 2

**Date:** 2026-06-12
**Status:** Approved design, ready for implementation planning

## Context

Third build slice of the chat platform (Discord-like app for ~30 school friends).
Shipped so far and merged to `main`: Foundation MVP (auth, one shared server with
text channels, realtime messaging, DMs) and rich-messaging Tier A (edit/delete,
markdown, reactions, image upload). See the prior specs in this directory.

"Rich messaging" still has several features left (replies, mentions, pins, threads,
link previews, non-image files, full emoji picker). This slice takes **replies,
mentions, and pins** — the most-used "directed message" features, none of which need
new infrastructure. Threads, link previews, non-image files, and the full emoji
picker remain for later slices.

The builder is newer to web development, so the design favors small, focused units
and the smallest amount of code that works.

## Goal

1. **Replies** — reply to a specific message, shown with a quoted preview line.
2. **Mentions** — `@username` with autocomplete and highlighting, including a
   "this mentions you" highlight.
3. **Pins** — anyone can pin/unpin a message; a per-channel pinned-messages panel.

## Scope

### In scope
- **Replies:** a ↰ reply action on any message; the composer shows a "Replying to X"
  bar with an **@ ON/OFF** ping toggle (default ON); the sent reply stores which
  message it replies to and whether it pings the author; rendered replies show a
  quoted preview line above the body.
- **Reply ping:** when the toggle is ON, the quoted preview line shows the original
  author's name as a mention (`@Sam: …`), and that author — and only that author —
  sees the reply with the "mentions you" highlight. When OFF, the preview shows the
  plain name (`Sam: …`) and nobody is highlighted. The replier never sees their own
  reply highlighted.
- **Mentions:** typing `@` in the composer opens a username autocomplete (queried
  from `profiles`); `@username` renders as a styled pill; a message that mentions the
  current user (via typed `@you` or a ping-reply to their message) gets a subtle
  highlight.
- **Pins:** a 📌 pin action on any message (any member can pin/unpin); the channel/DM
  header shows "📌 Pinned (n)" and opens a panel listing pinned messages (newest
  first) with an ✕ to unpin.

### Out of scope (later)
- Notifications/alerts/unread badges of any kind. "Ping" in this slice manifests
  only as the visual "mentions you" highlight; real alerts come with the future
  notification system, which will reuse this same mention signal.
- A "mentions inbox"/view of messages that mention you.
- Threads, link previews/unfurling, non-image file uploads, full emoji picker.
- Restricting who can pin (belongs to the roles/permissions sub-project #3).
- Editing a reply's ping flag or reply target after sending.

## Technical Decisions

- **Mentions rendering:** a small custom `remark` plugin (~15 lines) that turns
  `@username` text tokens into a styled mention node, composing with the existing
  `react-markdown` pipeline. Rejected: `remark-mentions` (renders profile links we
  don't have) and pre-processing text before markdown (fragile; risks reopening the
  XSS surface closed in the previous slice).
- **Pinning authorization:** a `toggle_pin(msg_id)` `security definer` function
  rather than a broad UPDATE policy, because row-level security can't restrict
  edits to a single column. This keeps content edits author-only while letting any
  member flip the pin state.
- **Reply previews:** resolved client-side from the already-loaded message list (by
  `reply_to_id`), not via a database join. Avoids join complexity and works with
  realtime (which delivers raw rows without embedded relations). Falls back to
  "Original message" when the target isn't loaded or was deleted.
- **Pins as columns on `messages`** (not a separate table): pin state travels with
  the message row, so it loads and updates live through the existing message
  handlers with no extra subscription.

## Database Changes

New migration `supabase/migrations/0003_replies_mentions_pins.sql`. All changes are
additions to `messages`:

- `reply_to_id uuid references public.messages(id) on delete set null`
- `mention_author boolean not null default true` (meaningful only when `reply_to_id`
  is set)
- `pinned boolean not null default false`
- `pinned_at timestamptz`
- Index on `(channel_id, pinned)` for the pinned-panel query.

### `toggle_pin` function
```
create or replace function public.toggle_pin(msg uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_read_message(msg) then
    raise exception 'not allowed';
  end if;
  update public.messages
    set pinned = not pinned,
        pinned_at = case when not pinned then now() else null end
    where id = msg;
end; $$;
```
(`can_read_message` already exists from the previous slice.) Granted to
`authenticated`.

### RLS
- No new table policies. The existing message INSERT policy (`author_id =
  auth.uid()`) already permits setting `reply_to_id`/`mention_author` on send. The
  existing author-only UPDATE/DELETE policies are unchanged; pin changes go through
  `toggle_pin`, not a direct UPDATE.

## Types

`src/types/db.ts` — extend `Message` with `reply_to_id: string | null`,
`mention_author: boolean`, `pinned: boolean`, `pinned_at: string | null`.

## Auth provider change

`AuthProvider` currently exposes the auth user (id, email) only. Extend it to also
load and expose the current user's `profiles` row (so `username` is available for
the "mentions me" check). Shape: add `profile: Profile | null` to the context.

## Components & Files

### New
- `src/lib/mentions.ts` — the custom remark mention plugin, plus a pure
  `mentionsMe(message, myUsername, repliedToAuthorId, myId)`-style helper that
  decides whether a message mentions the current user. Pure and unit-tested.
- `src/components/MentionAutocomplete.tsx` — the `@`-typing username dropdown in the
  composer; queries `profiles` by username prefix; selection inserts `@username`.
- `src/components/PinnedPanel.tsx` — the popover listing a channel/DM's pinned
  messages (queried newest-first) with unpin (✕) per row.

### Changed
- `src/components/MessageContent.tsx` — add the mention plugin to the markdown
  pipeline and style mention pills.
- `src/components/MessageItem.tsx` — render the reply preview line (resolved from
  loaded messages), add ↰ reply and 📌 pin hover actions, and apply the "mentions
  me" highlight.
- `src/components/MessageList.tsx` — forward the reply action callback to items and
  provide the loaded-messages lookup used for reply previews.
- `src/components/MessageInput.tsx` — reply bar with the @ ON/OFF toggle (sends
  `reply_to_id` + `mention_author`), and integrate `MentionAutocomplete`.
- `src/app/(app)/channels/[channelId]/page.tsx` and
  `src/app/(app)/dms/[conversationId]/page.tsx` — hold the reply-target state
  (shared between messages and composer) and add the "📌 Pinned (n)" header button +
  `PinnedPanel`.
- `src/components/providers/AuthProvider.tsx` — expose the current user's profile.
- `src/types/db.ts` — the new `Message` fields.

## UX Details

- **Reply:** ↰ on hover (any message) → composer shows "Replying to X" + @ ON/OFF
  (default ON) + ✕ cancel. The reply body is only the typed text; the ping `@` lives
  in the quoted preview line, not the body.
- **Reply preview:** `↰ @Author: snippet` when ping on, `↰ Author: snippet` when off;
  clicking it scrolls to the original if it's loaded.
- **Mentions me highlight:** appears only for the mentioned/pinged user; the author
  of a ping-reply never sees their own message highlighted.
- **Autocomplete:** triggered while typing an `@`-token; arrow/enter or click to pick;
  inserts `@username `.
- **Pins:** 📌 on hover toggles pin; header shows the live count and opens
  `PinnedPanel`. Pin/unpin updates live for everyone (rides the message row update).
- Grouping, edit/delete, reactions, and image rendering from prior slices are
  unaffected; the new bits attach to individual messages.

## Error Handling

- Reply to a deleted/missing original → preview shows "Original message"; the reply
  still sends.
- Pin/unpin failure → inline error; pin state is driven by the live row, so a failed
  toggle simply doesn't change anything.
- Autocomplete query failure → empty dropdown (no crash); the user can type the name
  manually.
- Mentions never fail (pure text); `@notauser` renders as a plain pill matching
  nobody.

## Testing

- **Automated unit tests** (`tests/mentions.test.ts`) on `lib/mentions.ts`:
  - the parser extracts `@username` tokens and ignores non-mentions (e.g. an email
    `a@b`, text without a leading boundary);
  - the "mentions me" helper returns true for a typed self-mention and for a
    ping-reply to my own message, and false otherwise (including a ping-reply with
    the toggle off, and a reply to someone else's message).
- **Manual checklist** (two browsers): reply with ping ON (other user sees the
  highlight) and OFF (no highlight); quoted preview shows `@author`/`author`
  correctly; `@` autocomplete inserts a username; a typed `@you` highlights for the
  mentioned user only; pin a message → it appears in the pinned panel and the header
  count updates live in the second browser; unpin removes it.
- No end-to-end browser automation (consistent with prior slices).
- A backend smoke test of `toggle_pin` and a reply insert (mirroring the prior
  slice's RLS smoke test) confirms the new function and columns work under RLS.

## Done Criteria

- Replies send with a working quoted preview and the @ ON/OFF ping toggle; the
  pinged author (only) sees the highlight.
- `@username` autocomplete works and mentions render as pills; "mentions me"
  highlighting is correct per-viewer.
- Any member can pin/unpin; the pinned panel and header count are correct and live.
- New unit tests pass; the backend smoke test passes; the manual checklist passes.

## Roadmap Position

After this slice, remaining rich-messaging features: threads, link previews,
non-image file uploads, full emoji picker — each its own slice. Then sub-project #3
(server management: roles/permissions, categories, invites, member list) and beyond.
