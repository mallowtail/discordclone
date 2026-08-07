# UI polish 1 — icon system (replace functional emoji) — design

**Date:** 2026-07-31
**Sub-project:** Taste-driven UI polish (Design Read B), slice 1 of 3 (1 icons → 2 typography/spacing → 3 interaction states).
**Status:** approved, ready for planning

## Goal

Replace **functional emoji UI controls** with a real icon set (Phosphor) at one consistent
weight, across every component. This is the highest-leverage "looks designed" lift from the
audit — emoji-as-controls render inconsistently per-OS and read as unfinished. **Content
emoji stay** (reactions, the emoji picker, message markdown).

## Decisions (from the audit)

- Icon library: **`@phosphor-icons/react`** (the taste skill's #1 pick; one family only).
- Icons inherit `currentColor`, so existing `text-muted` / `text-ink` / `text-accent` /
  `text-danger` classes keep controlling color — no color rework.
- Consistent sizing via the `size` prop; consistent `weight`. Default `weight="bold"` for
  small chrome controls (crisper at 14–18px on dark), `weight="regular"` for larger glyphs.
- Preserve behavior exactly — swap the glyph, keep the onClick/title/aria/layout. Add
  `aria-label`/`title` where an emoji was the only label.

## Icon map (use these EXACTLY, everywhere — this is the consistency contract)

| Current glyph | Meaning | Phosphor icon | size | weight |
|---|---|---|---|---|
| `✕` | close / cancel | `X` | 16 | bold |
| `＋` | add / new (rail, sidebar invite, new DM, composer +) | `Plus` | 18 | bold |
| `⚙` | server settings | `GearSix` | 18 | regular |
| `📌` | pin (indicator + Pinned button) | `PushPin` | 15 | fill (indicator) / regular (button) |
| `👥` | members button | `Users` | 16 | regular |
| `🏷` | manage roles | `ShieldStar` | 16 | regular |
| `💬` | DMs / home (server rail) | `ChatCircle` | 22 | regular |
| `↰` | reply (indicator + action) | `ArrowBendUpLeft` | 14 | bold |
| `▲` | move role up | `CaretUp` | 14 | bold |
| `▼` | move role down | `CaretDown` | 14 | bold |
| `▾` | category expanded | `CaretDown` | 12 | bold |
| `▸` | category collapsed | `CaretRight` | 12 | bold |
| `🙂` | emoji picker toggle | `Smiley` | 20 | regular |
| `📄` | file (download card + "+" upload menu item) | `File` | 18 (card) / 16 (menu) | regular |
| `📷 image` (reply/pin snippet text) | image attachment label | drop emoji → plain text `Image` (and `File` for files) | — | — |
| message **edit** action | edit | `PencilSimple` | 14 | regular |
| message **delete** action | delete | `Trash` | 14 | regular |
| Dropdown chevron (`▾`) | open select | `CaretDown` | 14 | bold |

If a component has a functional glyph not in this table, pick the nearest Phosphor icon and
note it in the task report so it can be reconciled.

## Do NOT touch (content emoji)

- `ReactionBar` reaction emojis + the reaction picker set.
- `emoji-picker-react` (the composer emoji picker itself).
- Message markdown/content text (user-typed emoji).
- Server/DM/avatar initials (not emoji).

## Files in scope (by area)

- **Servers/nav:** `ServerRail`, `ServerSidebar`, `ServerSettingsDialog`, `InviteDialog`,
  `CreateChannelDialog`, `CreateCategoryDialog`, `ui/Dropdown`.
- **Messages/composer:** `MessageInput` (+ menu / emoji button), `MessageItem` (reply arrow,
  pin indicator, snippet), `MessageActions` (edit/delete/pin/reply), `MessageContent` (file
  card), `PinnedPanel` (snippet, close).
- **Members/roles/DMs/user:** `MembersPanel` (roles button, close), `RolesDialog` (▲▼/⚙/✕/+),
  `RoleEditor`, `MemberRolesDialog`, `DmSidebar`, `NewDmDialog` (+), `UserPanel`, `ProfileDialog`.

## Usage convention

```tsx
import { X, Plus, GearSix } from "@phosphor-icons/react";
// inherits color from the surrounding text-* class:
<button className="text-muted hover:text-ink" aria-label="Close" onClick={onClose}>
  <X size={16} weight="bold" />
</button>
```
Keep the icon inside the existing colored/interactive element; do not add new color classes.
For icons that replaced a text label, ensure an `aria-label` or `title` is present.

## Non-goals (later polish slices)

- No typography scale / weight / spacing changes (**Polish 2**).
- No new hover/active/focus-state work beyond keeping what exists (**Polish 3**).
- No color/token changes. No new motion.

## Testing

Visual/mechanical slice — no unit-test surface. Verification:
1. `npm run build` succeeds; `npx vitest run` stays green (82; icons don't touch tested logic).
2. `@phosphor-icons/react` is in `dependencies`; one icon family only (no lucide/tabler added).
3. Grep confirms functional emoji are gone from the in-scope files (content emoji in
   `ReactionBar`/reactions untouched).
4. Manual: every control still works (close/add/settings/pin/members/roles/reply/reorder/
   chevrons/emoji-picker/file), icons are consistent in size/weight, colors match the prior
   glyph's color.

## Operational note

`npm install @phosphor-icons/react`. No migration, no env change.
