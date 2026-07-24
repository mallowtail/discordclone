# Profile cards + bio/status — design

**Date:** 2026-07-10
**Sub-project:** Aesthetics pass, slice 2 of 2 (slice 1 = rail polish + softer corners, merged)
**Status:** approved, ready for planning

## Goal

Turn the app's users into "actual profiles": clicking anyone's avatar or name opens an
anchored popover card (avatar, display name, @username, status, bio, "member since", and a
**Message** button), and people can set a short **bio** and **status** on themselves.

## Decisions (from brainstorming)

- Card is an **anchored popover** (Discord-style) next to the clicked avatar/name, rendered
  via a fixed-position portal (same trick as the rail flyout, so the chat's scroll can't clip
  it). Closes on outside-click / Escape.
- New profile fields: **status** (single line, ≤128 chars) and **bio** (short multi-line,
  ≤190 chars). Both optional.
- The card's **Message** button reuses the existing find-or-create-DM logic (extracted so it
  isn't duplicated). Hidden when you're looking at your own card.
- Triggers: click an avatar or name in **messages**, the **member panel**, or the **DM
  sidebar** list.

## Data model — `supabase/migrations/0009_profile_fields.sql`

```sql
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists status text;
```

No RLS change: `profiles` is already `select … using (true)` (world-readable) and
`update … using (id = auth.uid())` (self-only), which covers the new columns (row-level
update gates all columns of the row).

`Profile` type (`src/types/db.ts`) gains `bio: string | null` and `status: string | null`.

## Components & interfaces

### Pure helpers (tested)

- `src/lib/profile.ts`:
  - `export const STATUS_MAX = 128; export const BIO_MAX = 190;`
  - `clampProfileText(input: string, max: number): string` — trims, collapses to `""` when
    blank, truncates to `max` chars. Used before saving.
- `src/lib/popover.ts`:
  - `computePopoverPosition(anchor, card, viewport): { top: number; left: number }` where
    `anchor = { top, bottom, left, right }`, `card = { width, height }`,
    `viewport = { width, height }`. Places the card to the **right** of the anchor
    (`anchor.right + 8`); if it would overflow the right edge, places it to the **left**
    (`anchor.left - 8 - card.width`); clamps `left`/`top` to an 8px viewport margin. This is
    the whole reason the popover never lands off-screen — worth unit tests.

### DM helper (extraction)

- `src/lib/dm.ts`: `openDmWith(supabase, myId, otherId): Promise<string | null>` — the
  find-existing-1-on-1-else-create routine currently inline in `NewDmDialog.startDm`,
  returning the conversation id (or `null` on error). `NewDmDialog` is refactored to call it
  (no behavior change); the profile card's Message button also calls it.

### Popover provider (rendered once)

- `src/components/providers/ProfilePopoverProvider.tsx` + `useProfilePopover()`:
  holds `{ userId, anchorRect } | null`; exposes `open(userId: string, anchorRect: DOMRect)`;
  renders a single `<ProfileCard>` when open. Mounted in `src/app/(app)/layout.tsx` wrapping
  the app children, so every message/member/DM view can call `open(...)`.

### ProfileCard

- `src/components/user/ProfileCard.tsx`: given `{ userId, anchorRect, onClose }`, fetches the
  profile (`select * from profiles where id = userId`), and renders a `fixed` portal card
  (fixed width, e.g. `w-64`) positioned by `computePopoverPosition` using the card's measured
  height (`useLayoutEffect` + ref; render hidden until positioned to avoid a flash). Shows:
  avatar (lg), display name, `@username`, status (if set), bio (if set),
  "Member since <Month Year>" (from `created_at` via `toLocaleDateString`), and a **Message**
  button that calls `openDmWith` then routes to `/dms/<id>` and closes — **hidden when
  `userId === current user id`**. Outside-click and Escape close it.

### Trigger wiring

Add `onClick` (opening the popover with `e.currentTarget.getBoundingClientRect()`) to:
- `src/components/messages/MessageItem.tsx` — the author **avatar** and **name** (only when
  the header is shown). Must not interfere with existing message hover actions.
- `src/components/servers/MembersPanel.tsx` — each member **row** (avatar + name).
- `src/components/dms/DmSidebar.tsx` — each DM **row** (the other user's avatar/name).

### Editing

- `src/components/user/ProfileDialog.tsx` — add a **status** `<input maxLength=128>` and a
  **bio** `<textarea maxLength=190>` seeded from the current profile, plus a **Save** button
  that writes `clampProfileText`-ed `status`/`bio` to `profiles` and calls `refreshProfile()`.
  The existing avatar upload stays.

## Non-goals (YAGNI)

- No online/offline **presence** — `status` is a free-text line the user sets, not a
  connection indicator (no presence infra exists).
- No profile banners, pronouns, or badges.
- No dedicated profile route/page — the popover is the whole surface.
- No mutual-servers / roles display on the card.

## Testing

- **Unit:** `clampProfileText` (trim, blank→"", truncation at the limit) and
  `computePopoverPosition` (right-side default, left-side flip on right overflow, top/left
  viewport clamping) in `tests/profile.test.ts` and `tests/popover.test.ts`.
- **Backend smoke** (live DB, throwaway users): a user **can** update their own `bio`/`status`;
  an attempt to update **another** user's profile changes **0 rows** (existing self-only policy
  still holds with the new columns).
- Full `npx vitest run` stays green; `npm run build` clean.

## Operational note

Run `0009_profile_fields.sql` in the Supabase SQL editor before the live app shows/saves
bio/status (same pattern as every prior schema slice).
