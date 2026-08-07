# UI polish 2 — typography + spacing rhythm — design

**Date:** 2026-07-31
**Sub-project:** Taste-driven UI polish (Design Read B), slice 2 of 3 (1 icons ✅ → **2 typography/spacing** → 3 interaction states).
**Status:** ready for review

## Goal

Lift the flat type hierarchy and fix inconsistencies via a small set of exact **type
recipes** applied consistently — hierarchy through weight/tracking/consistency, NOT by
inflating sizes (a chat UI stays dense). Token-only; no layout restructuring, no new deps.

## Audit basis

- Dialog `<h2>` titles are inconsistent: sizes vary (base vs `text-lg`), margins vary
  (`mb-1`/`mb-2`/`mb-3`).
- Chrome headers use heavy `font-bold` (server name, "Direct Messages", "Members", Pinned
  label); softer `font-semibold` reads cleaner.
- Token drift: auth `<h1>`s use `text-white` instead of the `text-ink` token.
- Small uppercase section labels use 3–4 different recipes.
- Message body has no explicit line-height.

## The recipe contract (apply EXACTLY)

### R1 — Dialog titles (`<h2>` in modals)
Standardize **all** to: `text-[15px] font-semibold text-ink tracking-tight mb-4`.
Files: `CreateChannelDialog`, `CreateCategoryDialog`, `ProfileDialog`, `ServerSettingsDialog`
(`mb-3`→`mb-4`), `InviteDialog` (`mb-1`→`mb-4`), `NewDmDialog` (`mb-2`→`mb-4`),
`MemberRolesDialog` (drop `text-lg`, use the recipe). (RolesDialog title too if present.)

### R2 — Column / panel headers
Recipe: `font-semibold text-ink tracking-tight` (keep existing padding/border/flex).
- `ServerSidebar.tsx:65` server-name button: `font-bold` → `font-semibold`, add `tracking-tight`.
- `DmSidebar.tsx:42` "Direct Messages": `font-bold` → `font-semibold`, add `tracking-tight`.
- `MembersPanel.tsx:52` "Members" header: `font-bold` → `font-semibold`, add `tracking-tight`.
- `channels/[channelId]/page.tsx:42` and `dms/[conversationId]/page.tsx:39` headers: already
  `font-semibold`; add `tracking-tight`.

### R3 — Page titles (`<h1>`)
Recipe: keep size, `font-bold` → `font-semibold`, add `tracking-tight`; on the auth pages fix
the token.
- `login/page.tsx:32` + `register/page.tsx:48`: `text-xl font-bold text-white` →
  `text-xl font-semibold text-ink tracking-tight`.
- `invite/[code]/page.tsx:76`: `text-lg font-bold text-ink` → `text-lg font-semibold text-ink tracking-tight`.
- `users/[id]/page.tsx:63`: `text-xl font-bold text-ink truncate` →
  `text-xl font-semibold text-ink tracking-tight truncate`.

### R4 — Section labels (small uppercase)
Recipe: `text-[11px] font-semibold uppercase tracking-wider text-muted`.
- `ServerSidebar` category buttons (currently `text-[10px] uppercase tracking-wide`, keep the
  caret icon + collapse behavior; just swap the label classes to the recipe).
- `DmSidebar` "Direct Messages" sub-label row (`text-xs uppercase`).
- `PinnedPanel.tsx:40` label (`text-ink font-bold text-[11px] uppercase`) → the recipe
  (note this makes it `text-muted`, matching other labels; keep its icon).
- `users/[id]/page.tsx:70` "About" (`text-muted text-xs uppercase tracking-wide`).

### R5 — Message body readability
`MessageContent.tsx` — add `leading-relaxed` to the message-text wrapper (the `<div>` that
holds the rendered markdown). Do not touch the markdown heading overrides (content).

## Explicitly NOT changed

- Accent-button `text-white` (correct high-contrast on the `#7c9cff` accent) — leave.
- Markdown headings rendered inside messages (`MessageContent` h1/h2/h3 overrides) — that's
  user content, not chrome.
- `ServerIcon` initials `font-bold text-white` — legibility on the colored tile; leave.
- Font family, color tokens, radii, icons — untouched.

## Non-goals (later)

- No hover/active/focus-state work (**Polish 3**).
- No size inflation of body/list text (chat density stays).
- No spacing overhaul beyond the dialog-title `mb-4` standardization in R1.

## Testing

Visual/token slice — no unit surface. Verification:
1. `npm run build` succeeds; `npx vitest run` stays green (82).
2. Grep checks: dialog `<h2>`s all use the R1 recipe; no chrome `font-bold` left in the R2/R3
   targets; auth `<h1>`s use `text-ink` (no `text-white`).
3. Manual: dialog titles read consistent and a touch more present; sidebar/panel headers feel
   lighter/cleaner (not shouty); section labels are uniform; messages read comfortably. Nothing
   shifted layout or clipped.

## Operational note

No migration, no dep, no env change. Front-end branch.
