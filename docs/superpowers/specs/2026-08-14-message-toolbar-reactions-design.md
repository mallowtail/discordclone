# Message hover toolbar + synced recent-emoji reactions — design

**Date:** 2026-08-14
**Sub-project:** Rich-messaging — message actions. Slice **1 of 2** (**1 toolbar + recent-emoji reactions** → 2 Forward, Discord-style).
**Status:** approved, ready for planning

## Goal

Redesign the per-message hover toolbar into a Discord-style action bar and replace the fixed
6-emoji quick-react row with **account-synced recent emojis + a full emoji picker**. The
Forward button is intentionally deferred to slice 2 (added when it does something).

## The toolbar (after)

Top-right hover bar on each message, left→right:

`[recent 1] [recent 2] [recent 3] │ [😀 pick any emoji] [↩ reply] [⋯ more]`

- **recent 1–3:** the user's three most-recent reaction emojis (synced, see below). Clicking one
  runs `react(emoji)` on this message. Seeded with `👍 ❤️ 😂` until the user has reacted.
- **│** a thin vertical divider (`border-l border-line`, small height) between recents and the picker.
- **😀 pick any emoji:** opens the `emoji-picker-react` picker in a popover; choosing an emoji runs
  `react(emoji)`.
- **↩ reply:** existing behavior (`onReply`).
- **⋯ more:** a 3-dots (`DotsThree`) button opening a dropdown menu: **Pin/Unpin** always;
  **Edit** and **Delete** only on the user's own messages. (These move out of the always-visible bar.)
- **Forward:** NOT in this slice — added between reply and ⋯ in slice 2.

**Visibility fix:** the bar is `hidden group-hover:flex` today. It must also stay shown while the
picker or the ⋯ menu is open, or moving the mouse to the popover closes it. Drive visibility with a
local `open` flag: `className={open ? "flex" : "hidden group-hover:flex"}` where
`open = pickerOpen || menuOpen`.

## Recent emojis (synced to account)

### Migration — `supabase/migrations/0015_recent_emojis.sql`
```sql
-- Per-user most-recently-used reaction emojis (most-recent first), for the message toolbar.
alter table public.profiles
  add column if not exists recent_emojis text[] not null default '{}';

-- Atomically record an emoji as most-recent for the calling user: dedupe, unshift, cap at 12.
create or replace function public.push_recent_emoji(e text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set recent_emojis =
       (array[e] || array_remove(recent_emojis, e))[1:12]
   where id = auth.uid();
$$;

grant execute on function public.push_recent_emoji(text) to authenticated;
```
Notes:
- `array_remove(recent_emojis, e)` drops any prior copy; `array[e] || …` puts it in front;
  `[1:12]` caps length (Postgres array slice, 1-indexed inclusive).
- `security definer` + `where id = auth.uid()` means a caller can only ever mutate their own row.
- `recent_emojis` is read via the existing `profiles.select("*")` in `AuthProvider`; no read policy
  change (profiles are already readable, and this is the caller's own row anyway).

### Pure helper (tested) — `src/lib/recentEmojis.ts`
Mirrors the SQL so the client can optimistically compute the same order, and so the logic is unit-tested:
```ts
/** Most-recent-first list after using `emoji`: dedupe, unshift, cap at `max` (default 12). */
export function pushRecent(list: string[], emoji: string, max = 12): string[] {
  return [emoji, ...list.filter((x) => x !== emoji)].slice(0, max);
}

const SEED = ["👍", "❤️", "😂"];
/** The three emojis to show in the toolbar: user's recents, padded from SEED, no dupes, length 3. */
export function toolbarRecents(recent: string[]): string[] {
  const out = [...recent];
  for (const s of SEED) {
    if (out.length >= 3) break;
    if (!out.includes(s)) out.push(s);
  }
  return out.slice(0, 3);
}
```

### `src/types/db.ts`
Add `recent_emojis: string[];` to the `Profile` type (default `'{}'` → `[]` from PostgREST).

## The shared reaction path

Currently `ReactionBar.toggle(emoji, mine)` does the insert/delete. Centralize the "react + record
recent" behavior in **one `react` function defined inline in `MessageItem`** (it already holds every
dependency: `supabase`, `user`, `pills`, `msg`, and `refreshProfile` from `useAuth`), then pass it
down to both the toolbar and the pills. No new lib file for this — the only extracted, unit-tested
logic is the pure list math in `src/lib/recentEmojis.ts`.

`react(emoji: string): Promise<void>` in `MessageItem`:
1. `mine` = `pills.find((p) => p.emoji === emoji)?.mine ?? false` — does the current user already have
   this emoji on this message.
2. If `mine`: `delete` the reaction row (`message_id`, `user_id`, `emoji`). If not: `insert` it.
3. On an **add** only (not on remove): `await supabase.rpc("push_recent_emoji", { e: emoji })` then
   `await refreshProfile()` so the toolbar's recents reorder. (Removing a reaction does not touch recents.)

`MessageItem` passes `onReact={react}` and `recents={toolbarRecents(profile?.recent_emojis ?? [])}`
to `MessageActions`, and passes `onReact={react}` to `ReactionBar`. `ReactionBar`'s pills call
`onReact(p.emoji)` (dropping their own `toggle`/`supabase` code). One code path, one place for the RPC.

## `MessageActions` (rewritten)

New props (in addition to existing `onReply`, `onPin`, `pinned`, `canEdit`, `onEdit`, `onDelete`):
- `recents: string[]` (length 3), `onReact: (emoji: string) => void`.

Structure:
- Container `absolute right-2 top-0`, `className={open ? "flex" : "hidden group-hover:flex"}` plus
  the existing `gap-1 bg-surface rounded-xl border border-line px-1 py-0.5`.
- 3 recent-emoji buttons (`onClick={() => onReact(e)}`, `title={`React ${e}`}`), emoji-sized.
- Divider `<span className="mx-0.5 w-px self-stretch bg-line" />`.
- Picker button (`Smiley` icon) toggling `pickerOpen`; when open renders `emoji-picker-react`
  (`<EmojiPicker theme={Theme.DARK} onEmojiClick={(d) => { onReact(d.emoji); setPickerOpen(false); }}
  lazyLoadEmojis skinTonesDisabled />`) in an absolute popover (`absolute top-full right-0 mt-2 z-30`).
- Reply button (`ArrowBendUpLeft`, existing).
- ⋯ more button (`DotsThree`) toggling `menuOpen`; when open renders a dropdown
  (`absolute top-full right-0 mt-2 z-20 rounded-xl border border-line bg-surface shadow-lg py-1`)
  with Pin/Unpin (calls `onPin`), and when `canEdit` Edit (`onEdit`) + Delete (`onDelete`). Each menu
  item: `w-full flex items-center gap-2 px-3 py-1.5 text-sm text-ink hover:bg-surface-2 text-left`.
- Both popovers close on outside-click and Escape (reuse the composer's pattern:
  `useEffect` with `mousedown` + `keydown` listeners guarded by the open flag and a `ref`). Selecting
  a menu item closes the menu.

Icons: `Smiley`, `ArrowBendUpLeft`, `DotsThree`, `PushPin`, `PencilSimple`, `Trash` from
`@phosphor-icons/react` (all already used in the app except `DotsThree`, which is in the same package).

## `ReactionBar` (trimmed + kept styling)

- **Remove** the `hidden group-hover:flex` row of the 6 fixed `EMOJI` and the `EMOJI` constant
  (recents + picker replace it).
- **Keep** the pills, with the rounded-chip styling already applied (accent fill + accent count on
  `mine`, muted count otherwise, hover states). Pills call the shared `react(p.emoji)`.

## Non-goals (slice 1)

- **Forward** — slice 2 (adds the button + destination picker + `forwarded_from` schema + quoted render).
- No "frequently used" ranking — recents are strictly most-recently-used order.
- No reaction on remove touching recents (only adds record a recent).
- No emoji search/skin tones beyond what `emoji-picker-react` gives by default.
- No change to how reactions are fetched/realtime-updated (`useReactions` unchanged).

## Testing

- **Unit** (`tests/recentEmojis.test.ts`): `pushRecent` — new emoji unshifts to front; existing emoji
  moves to front (dedupe, no growth); caps at `max` (oldest drops); `toolbarRecents` — pads from SEED
  without dupes, always returns 3, user recents come first.
- **Migration:** controller diffs `0015_recent_emojis.sql` verbatim against this spec before the user
  runs it. Verify after running: react to a message → `select recent_emojis from profiles where id =
  auth.uid()` shows the emoji first; react again with a different one → it moves to front; a repeat
  emoji dedupes.
- **Build:** `npm run build` clean; `npx vitest run` green (adds recentEmojis tests).
- **Manual (localhost):** hover a message → toolbar shows 3 recents │ picker · reply · ⋯. Click a
  recent → reaction toggles; the emoji jumps to recents slot 1 and follows you to another
  browser/session (synced). Open the picker → choose any emoji → it reacts + becomes a recent.
  ⋯ opens Pin/Unpin (+ Edit/Delete on your own messages); each works and closes the menu. Picker/menu
  stay open when the mouse moves onto them, and close on outside-click/Escape. The old 6-emoji quick
  row is gone; pills still show counts with the mine-accent styling.

## Operational note

One migration (`0015_recent_emojis.sql`: one column + one SECURITY DEFINER RPC), no new dependency
(`emoji-picker-react` already installed), no env change. Front-end branch otherwise. The RPC only ever
writes the caller's own `profiles` row.
