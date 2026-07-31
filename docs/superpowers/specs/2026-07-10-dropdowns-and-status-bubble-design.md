# Custom dropdowns + status thought-bubble — design

**Date:** 2026-07-10
**Sub-project:** UI/messaging batch, slices B + C (built together; then D roles, E settings)
**Status:** approved, ready for planning

## Goal

Replace browser-default pickers with styled in-app UI (Discord-like dropdown + a real
dialog for new-category), and restyle a user's status as a **thought bubble** next to their
avatar on the profile surfaces.

## Decisions (from brainstorming)

- **B (dropdowns):** replace BOTH default-browser pickers — the native `<select>` (channel
  category) with a reusable styled `Dropdown`, and the `prompt("Category name")` with a
  proper in-app dialog.
- **C (status bubble):** show status as a **speech bubble with a little tail** aimed at the
  avatar, only when a status is set, on the **profile card + full user page** (replacing
  today's plain status line). Not on message/member/DM avatars.

## Current state

- `src/components/servers/CreateChannelDialog.tsx` — a native `<select value={categoryId}>`
  over `categories` inside a modal dialog.
- `src/components/servers/ServerSidebar.tsx` `addCategory()` — uses `prompt("Category name")`
  then inserts into `categories`.
- Status renders as a plain line: `ProfileCard.tsx:142`
  (`{profile?.status && <div ...>{profile.status}</div>}`) and `app/users/[id]/page.tsx:66`
  (`{profile.status && <p ...>{profile.status}</p>}`).
- Theme tokens: `bg-surface`, `bg-surface-2`, `border-line`, `text-ink`, `text-muted`,
  `bg-accent`, `hover:bg-accent-strong`. Dialog pattern: fixed overlay `onClick={onClose}` +
  card `onClick={(e) => e.stopPropagation()}`. The composer `+` menu shows the
  outside-click/Escape close pattern to mirror.

## Slice B — components

### `src/components/ui/Dropdown.tsx` (new, reusable)

```tsx
"use client";
// Props:
//   options: { value: string; label: string }[]
//   value: string
//   onChange: (value: string) => void
//   placeholder?: string
//   className?: string
```
- Renders a button showing the selected option's label (or `placeholder` when none matches) +
  a chevron (▾). Clicking toggles an `absolute` menu directly below the button
  (`bg-surface border border-line rounded-xl shadow-lg z-20`, full width).
- Each option is a row button (`hover:bg-surface-2`, `text-ink`, left-aligned); the currently
  selected option is marked (e.g. `text-accent` or a ✓). Choosing an option calls
  `onChange(value)` and closes the menu.
- Closes on outside-click (mousedown outside a wrapping `ref`) and Escape — effect gated on
  the open flag, listeners added/removed, mirroring the composer `+` menu.
- No portal (both call sites are inside centered modal dialogs with no scroll clipping). Basic
  keyboard: Escape closes; full arrow-key navigation is out of scope (YAGNI).

### Wire into `CreateChannelDialog.tsx`
Replace the `{categories.length > 0 && (<select>…</select>)}` block with:
```tsx
{categories.length > 0 && (
  <div className="mb-3">
    <Dropdown
      value={categoryId}
      onChange={setCategoryId}
      options={categories.map((c) => ({ value: c.id, label: c.name }))}
    />
  </div>
)}
```
(Import `Dropdown`. Keep `categoryId` state + everything else.)

### `src/components/servers/CreateCategoryDialog.tsx` (new) + wire into `ServerSidebar`
A small dialog matching `CreateChannelDialog`'s structure: overlay + card, an autofocused
text input ("Category name"), a Create button (+ error text). On create it inserts
`{ server_id, name: trimmed, position }` into `categories` (same insert `addCategory` does
now, using `categories.length` for `position`) and closes.
- Props: `{ serverId: string; position: number; onClose: () => void }`.
- In `ServerSidebar.tsx`: replace `addCategory` (the `prompt()` function) with an
  `addingCategory` boolean state; the "+ Category" button sets it true; render
  `{addingCategory && <CreateCategoryDialog serverId={serverId} position={categories.length}
  onClose={() => setAddingCategory(false)} />}`. Realtime already refreshes the list on
  insert (existing `categories` postgres_changes subscription), so no manual reload needed.

## Slice C — component

### `src/components/user/StatusBubble.tsx` (new)

```tsx
"use client";
export function StatusBubble({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  return (
    <div className="relative bg-surface-2 text-ink text-sm rounded-xl px-3 py-1.5 max-w-[180px]">
      {/* tail: a small rotated square poking toward the avatar on the left */}
      <span className="absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-2 rotate-45 bg-surface-2" aria-hidden="true" />
      <span className="break-words">{status}</span>
    </div>
  );
}
```
Renders nothing when `status` is empty/null.

### Placement (replace the plain status line)
- **`ProfileCard.tsx`**: the avatar is currently a standalone button, with name/username below.
  Put the avatar and `<StatusBubble status={profile?.status} />` in a **flex row** (`flex
  items-center gap-2`) so the bubble sits to the right of the avatar. Remove the old
  `{profile?.status && <div ...>` line (bubble replaces it). Keep the avatar's click→full-page
  behavior.
- **`app/users/[id]/page.tsx`**: the header row is already `flex items-center gap-4` (avatar +
  name/username). Add `<StatusBubble status={profile.status} />` into that row after the
  name block (so it reads beside the avatar/name). Remove the old
  `{profile.status && <p ...>` line.

## Non-goals (YAGNI)

- No arrow-key navigation / typeahead in `Dropdown` (Escape + click only).
- No status on message/member/DM avatars (profile surfaces only).
- No emoji/status presets, no timed/auto-clearing status.
- No portal for the dropdown menu (call sites are modal, unclipped).

## Testing

Both slices are presentational; no meaningful unit surface (Dropdown is prop-driven UI state,
StatusBubble is a pure conditional render). Verification:
1. `npm run build` succeeds; `npx vitest run` stays green (no regressions).
2. Manual: (a) create-channel dialog shows the styled category dropdown, opens/selects/closes
   on outside-click + Escape, and the chosen category is used on create; (b) "+ Category"
   opens the styled dialog (no browser prompt) and creating adds the category live; (c) a user
   with a status shows the thought bubble beside their avatar on the profile card and the full
   user page; a user with no status shows no bubble.

## Operational note

No migration, no dependency, no env change — normal front-end branch.
