# Profile cards + bio/status + full user page — design

**Date:** 2026-07-24
**Sub-project:** Aesthetics pass, slice 2 of 2 (slice 1 = rail polish + softer corners, merged)
**Status:** approved, ready for planning

## Goal

Turn users into "actual profiles": clicking anyone's avatar or name opens an anchored
popover card showing who they are, their status, bio, and server role, with an inline
"Message @User" box that DMs them directly. Clicking the avatar inside the card opens their
**full user page**. People can set a short **bio** and **status** on themselves.

## Decisions (from brainstorming)

- **Anchored popover** (Discord-style) next to the clicked avatar/name, via a fixed-position
  portal (same trick as the rail flyout, so chat scroll can't clip it). Closes on
  outside-click / Escape.
- Card shows: **display name**, **@username**, **status**, **bio** (line-clamped to 3 lines
  with a "View full bio" toggle when longer), **server role tier badge** (only when opened in
  a server context), and an inline **"Message @User"** composer at the bottom.
- **Mutual friends: deferred** — the app has no friends system; that's a separate future
  sub-project. Not shown on the card for now.
- **Roles = per-server tier** (Owner / Admin / Member). Shown for the server you're currently
  in (card opened from a channel message or the member list). In a DM (no server) there's no
  role line.
- **Message box** sends the typed text as a DM (find-or-create the conversation), then
  navigates into `/dms/<id>` and closes the card.
- **Full user page** at `/users/[id]` (a new standalone route), opened by clicking the avatar
  inside the popover.
- New profile fields: **status** (single line, ≤128 chars) and **bio** (short multi-line,
  ≤190 chars). Both optional.

## Data model — `supabase/migrations/0009_profile_fields.sql`

```sql
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists status text;
```

No RLS change: `profiles` is already `select … using (true)` (world-readable) and
`update … using (id = auth.uid())` (self-only), covering the new columns.

`Profile` type (`src/types/db.ts`) gains `bio: string | null` and `status: string | null`.

## Components & interfaces

### Pure helpers (tested)

- `src/lib/profile.ts`:
  - `export const STATUS_MAX = 128; export const BIO_MAX = 190;`
  - `clampProfileText(input: string, max: number): string` — trims, blank→`""`, truncates to
    `max`. Used before saving.
- `src/lib/popover.ts`:
  - `computePopoverPosition(anchor, card, viewport): { top: number; left: number }` —
    `anchor = { top, bottom, left, right }`, `card = { width, height }`,
    `viewport = { width, height }`. Places the card to the **right** of the anchor
    (`anchor.right + 8`); if it would overflow the right edge, flips to the **left**
    (`anchor.left - 8 - card.width`); clamps `left`/`top` to an 8px viewport margin.

### DM helper (extraction)

- `src/lib/dm.ts`: `openDmWith(supabase, myId, otherId): Promise<string | null>` — the
  find-existing-1-on-1-else-create routine currently inline in `NewDmDialog.startDm`,
  returning the conversation id (or `null` on error). `NewDmDialog` is refactored to call it;
  the card's Message composer also calls it.

### Popover provider (rendered once)

- `src/components/providers/ProfilePopoverProvider.tsx` + `useProfilePopover()`:
  holds `{ userId, anchorRect, serverId } | null`; exposes
  `open(userId: string, anchorRect: DOMRect, serverId?: string)`; renders one `<ProfileCard>`
  when open. Mounted in `src/app/(app)/layout.tsx` wrapping the app children.

### ProfileCard (the popover)

- `src/components/user/ProfileCard.tsx`: given `{ userId, anchorRect, serverId, onClose }`:
  - Fetches the profile (`select * from profiles where id = userId`).
  - When `serverId` is set, resolves the person's **tier**: `OWNER` if
    `servers.owner_id === userId`, else their `server_members.role` (`admin` → `ADMIN` badge,
    `member` → "Member"). Reuse the badge style already used in `MembersPanel`.
  - Renders a `fixed` portal card (fixed width, e.g. `w-64`) positioned by
    `computePopoverPosition` using the card's measured height (`useLayoutEffect` + ref; render
    hidden until positioned to avoid a flash).
  - Content: avatar (lg), display name, `@username`, role badge (if resolved), status (if
    set), bio (if set) **clamped to 3 lines** with a **"View full bio"** button that expands
    it inline when it overflows, "Member since <Month Year>" (from `created_at` via
    `toLocaleDateString`), and at the bottom an inline **"Message @<username>"** text input.
  - **Message composer:** typing + Enter validates via `validateMessage`, calls `openDmWith`,
    inserts the message (`messages` insert with `conversation_id`, `author_id`, `content`),
    then `router.push('/dms/<id>')` and `onClose()`. The composer is **hidden when
    `userId === current user id`** (can't DM yourself).
  - **Avatar click** → `router.push('/users/<userId>')` then `onClose()`.
  - Outside-click and Escape close it.

### Full user page (new route)

- `src/app/users/[id]/page.tsx` — a standalone page (outside the `(app)` group; no server
  chrome, with a "← Back" affordance). Fetches the profile by `id` and shows the expanded
  view: avatar (lg), display name, `@username`, status, **full bio** (not clamped), "Member
  since <Month Year>", and a **Message** button (`openDmWith` → `/dms/<id>`) hidden when it's
  your own page. No role badge here (roles are server-scoped; this page has no server context).

### Trigger wiring

Open the popover with `e.currentTarget.getBoundingClientRect()` (+ server id where known):
- `src/components/messages/MessageItem.tsx` — author **avatar** and **name** (header row);
  pass the channel's `server_id` for the role badge. Must not disturb existing message hover
  actions.
- `src/components/servers/MembersPanel.tsx` — each member **row**; pass its `serverId`.
- `src/components/dms/DmSidebar.tsx` — each DM **row** (the other user); no serverId.

### Editing

- `src/components/user/ProfileDialog.tsx` — add a **status** `<input maxLength=128>` and a
  **bio** `<textarea maxLength=190>` seeded from the current profile, plus a **Save** button
  that writes `clampProfileText`-ed `status`/`bio` to `profiles` and calls `refreshProfile()`.
  The existing avatar upload stays.

## Non-goals (YAGNI)

- No **friends system** / mutual friends (separate future sub-project).
- No online/offline **presence** — `status` is free text the user sets, not a connection dot.
- No profile banners, pronouns, or badges beyond the server-tier role.
- No roles on the full user page (no server context there).

## Testing

- **Unit:** `clampProfileText` (trim, blank→"", truncation) and `computePopoverPosition`
  (right-side default, left flip on right overflow, top/left clamping) in
  `tests/profile.test.ts` and `tests/popover.test.ts`.
- **Backend smoke** (live DB, throwaway users): a user **can** update their own `bio`/`status`;
  updating **another** user's profile changes **0 rows**; the Message composer's insert lands
  in the shared conversation (find-or-create + message insert succeeds between two users).
- Full `npx vitest run` stays green; `npm run build` clean; the new `/users/[id]` route builds.

## Operational note

Run `0009_profile_fields.sql` in the Supabase SQL editor before the live app shows/saves
bio/status (same pattern as every prior schema slice).
