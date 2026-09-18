# Design Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Close the design gaps found in the 2026-09-18 audit: missing affordances (active channel, unread, presence, responsive), missing system (shared modal, radius/type tokens, skeletons/empty states), and detail defects (native `confirm()`, image layout shift, mention/flash collision, no branding).

**Architecture:** Add a semantic token layer to `globals.css` (radius + type, alongside the existing colour tokens), build a small set of UI primitives under `src/components/ui/`, then roll those primitives through the existing component tree. Data-backed features (presence, unread) get their own hooks; only unread needs a schema change.

**Tech Stack:** Next.js 16.2.6 (App Router), React 19.2.4, Tailwind CSS v4, TypeScript, Supabase (`@supabase/ssr`), Vitest, Phosphor Icons.

---

## Global Constraints

These bind every task. Reviewers check against them verbatim.

**G1 — This is Next.js 16, not an earlier Next.js.** Before writing code that touches a Next.js API, read the relevant guide under `node_modules/next/dist/docs/`. Specifically established for this plan:
- Proxy/middleware is `src/proxy.ts` with an exported `proxy` function. The `middleware` filename and named export are deprecated. Do not create `middleware.ts`.
- In `icon`, `apple-icon`, `opengraph-image` and `twitter-image` generator files, the props `params` and `id` are **Promises**. Generator functions must be `async` and `await` them.
- Next.js 16 no longer overrides `scroll-behavior` during navigation. **Do not** add `scroll-behavior: smooth` to `html`/`:root` in `globals.css`. Existing explicit `element.scrollIntoView({ behavior: "smooth" })` calls stay as they are.
- `images.domains` is deprecated (use `remotePatterns`). This plan does not adopt `next/image` for remote Supabase URLs — see G7.

**G2 — Tailwind v4 token syntax.** New tokens are declared in the existing `@theme inline { ... }` block in `src/app/globals.css`. Do **not** add a `tailwind.config.js`; this project has no Tailwind config file and must not gain one.

**G3 — Never redefine a Tailwind built-in token.** Do not set `--radius-sm`, `--radius-lg`, `--text-xs`, `--text-sm`, `--text-base`, or any other Tailwind default scale key. Redefining them silently changes every existing `rounded-lg` / `text-sm` in the codebase. All new tokens use the project-specific names given in Task 1 verbatim.

**G4 — Exact token names.** Radius: `--radius-row`, `--radius-control`, `--radius-card`, `--radius-modal`, `--radius-pill`. Type: `--text-micro`, `--text-meta`, `--text-body`, `--text-title`, `--text-display`. Generated utilities are `rounded-row`, `rounded-control`, `rounded-card`, `rounded-modal`, `rounded-pill`, `text-micro`, `text-meta`, `text-body`, `text-title`, `text-display`.

**G5 — Appearance-only unless the task says otherwise.** Do not change component props, data flow, query shapes, or business logic in `src/lib/*` while restyling. `src/lib/` gains exactly two new files — `avatarColor.ts` (Task 2) and `unread.ts` (Task 6) — and no edits to any existing file there.

**G6 — Do not touch:** any existing file in `supabase/migrations/` (0001–0022), `src/proxy.ts`, `src/lib/supabase/*`, any of the 20 existing files in `tests/`, `package.json`, `next.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `eslint.config.mjs`, `vitest.config.ts`.

**G7 — Attachment images stay as `<img>`.** Adopting `next/image` for Supabase-hosted URLs would require `images.remotePatterns` in `next.config.ts`, which G6 forbids. Layout shift is fixed with a fixed-size container instead (Task 9).

**G8 — Dark-only app.** There is no light theme and none is being added. `color-scheme: dark` is declared so native UI (autofill, native scrollbars, date pickers) renders dark.

**G9 — Verification.** `npx tsc --noEmit` and `npm run lint` must pass before any commit. `npm test` must pass (20 existing test files plus any added). Report the command and its output.

**G10 — Accessibility is not optional.** Every interactive element keeps an accessible name (`aria-label` or visible text). New overlays (Modal, Drawer) trap focus, close on `Escape`, restore focus to the trigger on close, and set `role="dialog"` + `aria-modal="true"`. Decorative icons get `aria-hidden="true"`.

---

## Canonical Token Map

Applies to Task 10's sweep and to every task that writes new markup.

| Old class | Context | New class |
|---|---|---|
| `rounded` | list rows, member rows, small chips | `rounded-row` |
| `rounded-lg` | channel links, tooltips, menu rows | `rounded-row` |
| `rounded-xl` | inputs, buttons, menus, file chips | `rounded-control` |
| `rounded-2xl` | composer, cards, panels, user panel | `rounded-card` |
| dialog panels (any radius) | modal surfaces | `rounded-modal` |
| `rounded-full` | avatars, dots, pills | `rounded-pill` |
| `text-[11px]` | timestamps, reply preview, category labels | `text-micro` |
| `text-xs` | helper text, secondary metadata | `text-meta` |
| `text-sm` / unset body text | message body, default UI text | `text-body` |
| `font-semibold` panel/channel headers | section + panel headers | `text-title` |
| `text-xl` dialog titles | modal + profile titles | `text-display` |

`rounded-full` on avatars and status dots stays semantically a pill — use `rounded-pill`.

---

## Prerequisites

- [ ] **P1: Node on PATH** — `node --version` (v20+). If missing: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"`.
- [ ] **P2: Branch** — all work lands on `design-overhaul`.

---

## Task 1: Semantic tokens, global CSS fixes, root metadata

**Files:** Modify `src/app/globals.css`, `src/app/layout.tsx`

- [ ] **Step 1:** In the existing `@theme inline` block in `globals.css`, keep every current colour token unchanged and append the radius and type scales. Use these names and values verbatim:

```css
  --radius-row: 0.5rem;
  --radius-control: 0.75rem;
  --radius-card: 1.125rem;
  --radius-modal: 1.375rem;
  --radius-pill: 9999px;

  --text-micro: 0.6875rem;
  --text-micro--line-height: 1.45;
  --text-meta: 0.75rem;
  --text-meta--line-height: 1.5;
  --text-body: 0.875rem;
  --text-body--line-height: 1.6;
  --text-title: 0.9375rem;
  --text-title--line-height: 1.4;
  --text-display: 1.25rem;
  --text-display--line-height: 1.3;
```

- [ ] **Step 2:** Add `color-scheme: dark;` to a `:root` rule in `globals.css` (G8). This is what stops Chrome rendering autofilled login inputs on a white background.
- [ ] **Step 3:** In the `:focus-visible` rule, **delete the `border-radius: 2px;` line**. Outlines follow the element's own `border-radius` automatically; the hardcoded 2px is what cuts corners on `rounded-2xl` buttons. Keep `outline` and `outline-offset`.
- [ ] **Step 4:** Add a reduced-motion-safe `@keyframes` pair used by Task 2's overlays — `overlay-in` (opacity 0→1) and `panel-in` (opacity 0→1 plus `translateY(6px) scale(0.98)`→`none`), each ~150ms ease-out. Wrap the applied animations so they are disabled under the existing `@media (prefers-reduced-motion: reduce)` block.
- [ ] **Step 5:** In `src/app/layout.tsx`, replace the placeholder metadata. Title `"Mallowchat"` with a template (`%s · Mallowchat`), a real description, and `openGraph` fields. Read `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md` first and confirm where `themeColor` / `colorScheme` belong in Next 16 — if they belong on a `viewport` export, add that export rather than putting them in `metadata`.
- [ ] **Step 6:** Verify per G9 and commit.

**Do not** restyle any component in this task. Tokens are declared here and consumed later.

---

## Task 2: UI primitives and avatar colour

**Files:** Create `src/components/ui/Modal.tsx`, `src/components/ui/ConfirmDialog.tsx`, `src/components/ui/Skeleton.tsx`, `src/components/ui/EmptyState.tsx`, `src/components/ui/Drawer.tsx`, `src/lib/avatarColor.ts`, `tests/avatarColor.test.ts`

Read `src/components/servers/AddServerDialog.tsx` and `src/components/user/FullProfileModal.tsx` first — the new `Modal` must be able to replace both shapes.

- [ ] **Step 1: `Modal.tsx`.** Props: `onClose: () => void`, `title?: ReactNode`, `size?: "sm" | "md" | "lg"`, `children`. Behaviour:
  - Renders through `createPortal` into `document.body`.
  - Backdrop `bg-black/60 backdrop-blur-sm`, panel `bg-surface border border-line rounded-modal shadow-2xl`.
  - Closes on backdrop **mousedown** (not click — a text selection that ends on the backdrop must not close it) and on `Escape`.
  - `role="dialog"`, `aria-modal="true"`, `aria-labelledby` wired to the title when one is given.
  - Focus moves into the panel on open and returns to the previously focused element on close. Tab cycles within the panel.
  - Locks body scroll while open, restoring the prior value on unmount.
  - Applies the `overlay-in` / `panel-in` animations from Task 1.
  - Panel is `max-h-[85vh]` with its own scroll area, and `w-[min(92vw,<size>)]` so it never overflows a phone.
- [ ] **Step 2: `ConfirmDialog.tsx`,** built on `Modal`. Props: `title`, `message`, `confirmLabel` (default `"Confirm"`), `cancelLabel` (default `"Cancel"`), `destructive?: boolean`, `onConfirm`, `onClose`. Destructive confirms render the action button in `bg-danger`. The confirm button takes initial focus.
- [ ] **Step 3: `Skeleton.tsx`.** A single `Skeleton` component taking `className`, rendering a `bg-surface` block with a subtle pulse that is disabled under `prefers-reduced-motion`. Export `SkeletonText` (n lines) and `SkeletonRow` (avatar circle + two lines) helpers used by Task 8.
- [ ] **Step 4: `EmptyState.tsx`.** Props: `icon?: ReactNode`, `title: string`, `description?: string`, `action?: ReactNode`. Centred, muted, generous vertical padding.
- [ ] **Step 5: `Drawer.tsx`.** A left-anchored slide-over used only below `md` by Task 7. Props: `open`, `onClose`, `children`, `label` (accessible name). Same focus/Escape/scroll-lock contract as `Modal`. Slides from `-translate-x-full` to `translate-x-0`; transition disabled under `prefers-reduced-motion`. Backdrop dismisses.
- [ ] **Step 6: `src/lib/avatarColor.ts`.** Export `avatarColor(seed: string): { bg: string; fg: string }` and `initials(name: string | null | undefined): string`.
  - `avatarColor` hashes the seed deterministically (same seed always returns the same pair) and picks from a fixed palette of 8 pairs, each with a contrast ratio of at least 4.5:1 between `bg` and `fg`. Palette values are hex strings chosen to sit comfortably on the app's dark surfaces.
  - `initials` returns at most 2 characters, uppercased, from the first and last whitespace-separated words; returns `"?"` for null/empty/whitespace-only input. Must handle single-word names, extra whitespace, and non-ASCII letters without throwing.
- [ ] **Step 7: TDD.** Write `tests/avatarColor.test.ts` **before** the implementation. Cover: determinism (same seed → same colour across calls), distribution (several distinct seeds do not all collide on one palette entry), every `initials` edge case above, and that every palette entry is a valid hex pair. Show RED then GREEN output in the report.
- [ ] **Step 8:** Verify per G9 and commit.

No existing component is modified in this task — primitives only.

---

## Task 3: Roll out Modal and ConfirmDialog

**Files:** Modify `src/components/servers/AddServerDialog.tsx`, `CreateCategoryDialog.tsx`, `CreateChannelDialog.tsx`, `InviteDialog.tsx`, `MemberRolesDialog.tsx`, `RolesDialog.tsx`, `ServerSettingsDialog.tsx`, `MemberModMenu.tsx`, `src/components/messages/ForwardDialog.tsx`, `src/components/messages/MessageItem.tsx`, `src/components/dms/NewDmDialog.tsx`, `src/components/user/FullProfileModal.tsx`, `src/components/user/UserSettings.tsx`

- [ ] **Step 1:** Replace the hand-rolled `fixed inset-0 bg-black/60 flex items-center justify-center z-50` wrapper in each of the 9 dialog files with `<Modal>`. Delete the now-dead `onClick={onClose}` backdrop handlers and any `stopPropagation` guards that existed only to protect against them. Preserve each dialog's existing body, fields, submit handlers, and error states exactly.
- [ ] **Step 2:** Replace all four native `confirm()` calls with `<ConfirmDialog destructive>`:
  - `MessageItem.tsx:~85` — "Delete this message?"
  - `MemberModMenu.tsx:~52` — "Kick {name}? They can rejoin with an invite."
  - `RolesDialog.tsx:~61` — `Delete role "{name}"?`
  - `ServerSettingsDialog.tsx:~56` — "Leave {server}?"
  Each needs local open/close state; the destructive action runs on confirm and the dialog closes afterwards. Keep the existing error handling on failure.
- [ ] **Step 3:** `UserSettings.tsx` is a full-screen surface (`fixed inset-0 z-50 bg-app flex`), **not** a centred dialog. Do not convert it to `Modal`. Only align its radii and type to the Canonical Token Map, and make sure it still closes on `Escape`.
- [ ] **Step 4:** Apply `rounded-modal` to dialog panels and the Canonical Token Map to controls inside the files you touch.
- [ ] **Step 5:** Verify per G9 and commit. Manually confirm in the report that each converted dialog still opens, submits, and closes.

---

## Task 4: Avatar initials and presence

**Files:** Modify `src/components/user/Avatar.tsx`, `src/components/servers/MembersPanel.tsx`, `src/components/dms/DmSidebar.tsx`, `src/components/user/UserPanel.tsx`, `src/components/user/ProfileCard.tsx`, `src/components/user/FullProfileModal.tsx`; create `src/hooks/usePresence.ts`

- [ ] **Step 1: `Avatar.tsx`.** When `url` is absent or the image fails, render deterministic initials via `avatarColor(seed)` + `initials(name)` instead of the grey silhouette. Add an **optional** `seed?: string` prop (callers pass the user id so colour is stable even when a display name changes); fall back to `name` when `seed` is absent. Initials scale with the existing size map. Keep the `onError` fallback path.
- [ ] **Step 2:** Add an optional `presence?: "online" | "offline"` prop. When present, render a dot in the bottom-right, `bg-online` for online and `bg-muted` for offline, ringed in the surrounding surface colour so it reads as a cutout. The dot is `aria-hidden`; the online state is conveyed to assistive tech by the accessible name of the surrounding control, so callers append it there. When `presence` is omitted, render no dot at all (current behaviour).
- [ ] **Step 3: `usePresence.ts`.** Supabase Realtime Presence, not a database table — read `src/hooks/useServers.ts` for the established client/subscription/cleanup pattern first. Join a single global channel, track the signed-in user id, and return `{ onlineIds: Set<string>, isOnline: (id: string) => boolean }`. Must unsubscribe on unmount and must not throw when there is no session.
- [ ] **Step 4: `MembersPanel.tsx`.** Group members into "Online" and "Offline" sections, each with a count in its header, preserving the existing role-colour, moderation-menu and manage-roles behaviour exactly. Offline members' avatars and names render at reduced opacity. When a group is empty, omit its header entirely.
- [ ] **Step 5:** Pass `seed={user id}` and presence through in `DmSidebar`, `UserPanel`, `ProfileCard`, and `FullProfileModal`.
- [ ] **Step 6:** Verify per G9 and commit.

---

## Task 5: Active channel state

**Files:** Modify `src/components/servers/ServerSidebar.tsx`, `src/components/dms/DmSidebar.tsx`

- [ ] **Step 1:** In `ServerSidebar`, derive the active channel from `usePathname()` (the route is `/channels/<id>`). The active link gets a distinctly lighter background, `text-ink`, and `aria-current="page"`. Hover state stays for inactive links. The difference between active and hover must be clearly visible, not a 2% shade.
- [ ] **Step 2:** Same treatment in `DmSidebar` for `/dms/<id>`.
- [ ] **Step 3:** Replace the literal `"# "` text prefix on channel links with a Phosphor `Hash` icon at `text-muted`, sized to match the label, `aria-hidden="true"` (the channel name already carries the accessible name). The active channel's hash brightens with the label.
- [ ] **Step 4:** Apply `rounded-row` and `text-body` to the links per the Canonical Token Map.
- [ ] **Step 5:** Verify per G9 and commit.

This task must not depend on Task 6. Active state ships whether or not unread lands.

---

## Task 6: Unread indicators

**Files:** Create `supabase/migrations/0023_channel_reads.sql`, `src/hooks/useUnread.ts`, `src/lib/unread.ts`, `tests/unread.test.ts`; modify `src/types/db.ts`, `src/components/servers/ServerSidebar.tsx`, `src/components/servers/ServerRail.tsx`, `src/app/(app)/channels/[channelId]/page.tsx`

Read `supabase/migrations/0001_init.sql`, `0005_servers.sql` and `0018_moderation.sql` first to match this project's established table, RLS-policy and naming conventions. Do not deviate from them.

- [ ] **Step 1: Migration `0023_channel_reads.sql`.** A `channel_reads` table keyed on (`user_id`, `channel_id`) storing `last_read_at timestamptz not null default now()`. Both foreign keys cascade on delete. Enable RLS. Policies must allow a user to select, insert and update **only their own** rows — a user must never be able to read another user's read state. Follow the exact policy-naming style used in the existing migrations.
- [ ] **Step 2: DO NOT RUN `supabase db push`.** Write the migration file only. The controller applies it to the live database after review. An implementer that runs a migration against production is a Critical finding.
- [ ] **Step 3: `src/lib/unread.ts`.** Pure functions, no Supabase imports: `unreadCount(messages, lastReadAt, myUserId)` returns how many messages are newer than `lastReadAt` and not authored by `myUserId`; `hasUnread(...)` is the boolean form. Null/undefined `lastReadAt` means everything is unread. Messages authored by me are never unread.
- [ ] **Step 4: TDD.** `tests/unread.test.ts` before the implementation: never-read channel, fully-read channel, partially-read channel, own messages excluded, empty message list, and a `lastReadAt` exactly equal to a message timestamp (equal is read, not unread). RED then GREEN in the report.
- [ ] **Step 5: `src/types/db.ts`.** Add the `ChannelRead` row type alongside the existing types, matching their style.
- [ ] **Step 6: `useUnread.ts`.** Loads the signed-in user's read rows for a server's channels, subscribes to new messages, and exposes per-channel unread state plus a `markRead(channelId)` that upserts `last_read_at`. Follow the subscription/cleanup pattern in `src/hooks/useServerPermissions.ts`. Must degrade quietly to "nothing unread" if the query errors, so a missing table can never break the sidebar.
- [ ] **Step 7: UI.** In `ServerSidebar`, unread channels render their name in `text-ink` at `font-semibold` with a small dot at the row's left edge; read channels are unchanged. In `ServerRail`, a server with any unread channel gets a badge on its icon. The active channel is never shown as unread.
- [ ] **Step 8:** In the channel page, call `markRead` when the channel is opened and when new messages arrive while it is focused.
- [ ] **Step 9:** Verify per G9 and commit. State plainly in the report that the UI could not be exercised against the live table because the migration is unapplied.

---

## Task 7: Responsive layout that scales with device size

**Files:** Modify `src/app/(app)/layout.tsx`, `src/app/(app)/channels/[channelId]/page.tsx`, `src/app/(app)/dms/[conversationId]/page.tsx`, `src/components/servers/ServerRail.tsx`, `src/components/servers/ServerSidebar.tsx`, `src/components/servers/MembersPanel.tsx`, `src/components/dms/DmSidebar.tsx`, `src/components/messages/MessageInput.tsx`, `src/components/messages/MessageActions.tsx`, `src/components/messages/MessageItem.tsx`

The app is currently fixed at 428px of chrome before any content and is unusable below ~900px. Three layout modes, with **fluid sizing inside each** so widths scale rather than snap:

| Viewport | Rail | Channel sidebar | Members |
|---|---|---|---|
| `< md` (<768px) | in drawer | in drawer | overlay only |
| `md`–`lg` | visible, fluid | visible, fluid | overlay via header toggle |
| `≥ xl` (≥1280px) | visible, fluid | visible, fluid | inline column, fluid |

- [ ] **Step 1: Fluid widths.** Replace the fixed `w-[72px]` / `w-60` / `w-56` with clamped widths so they scale with the viewport: rail `w-[clamp(3.5rem,5vw,4.5rem)]`, channel sidebar `w-[clamp(12.5rem,18vw,16.25rem)]`, members `w-[clamp(12.5rem,16vw,15rem)]`. Avatars and icons inside stay fixed — only the columns breathe.
- [ ] **Step 2: Drawer below `md`.** In `(app)/layout.tsx`, hold the drawer's open state and render the rail + sidebar inside Task 2's `Drawer` below `md`, inline above it. Chat takes the full width when the drawer is closed. Opening a channel closes the drawer.
- [ ] **Step 3: Drawer trigger.** Add a hamburger button to the channel and DM page headers, visible only below `md`, with `aria-label="Open navigation"` and `aria-expanded` wired to the drawer state.
- [ ] **Step 4: Members panel.** Below `xl`, render it as a right-anchored overlay above the chat rather than an inline column; at `xl` and up it stays inline. The existing header toggle drives both.
- [ ] **Step 5: Touch targets.** Interactive controls in the composer, the message hover toolbar, and sidebar rows must be at least 44×44px below `md`. The message hover toolbar is hover-only and therefore unreachable on touch — below `md`, surface it via a persistent "more actions" button on each message instead.
- [ ] **Step 6: Composer and pickers.** The emoji picker currently renders at a fixed width and will overflow a phone. Constrain it to the viewport below `md`. The composer's own padding tightens below `md`.
- [ ] **Step 7: Message rows.** Reduce the avatar gutter and horizontal padding below `md` so message text is not squeezed into a narrow column.
- [ ] **Step 8:** Verify per G9. Additionally confirm no horizontal page scroll at 375px, 768px, 1024px and 1440px, and state how you checked. Commit.

---

## Task 8: Loading and empty states

**Files:** Modify `src/components/messages/MessageList.tsx`, `src/components/servers/ServerSidebar.tsx`, `src/components/servers/MembersPanel.tsx`, `src/components/dms/DmSidebar.tsx`, `src/app/(app)/channels/[channelId]/page.tsx`, `src/app/(app)/channels/first/page.tsx`, `src/app/(app)/dms/page.tsx`, `src/app/(app)/dms/[conversationId]/page.tsx`, `src/app/users/[id]/page.tsx`, `src/app/invite/[code]/page.tsx`

Use Task 2's `Skeleton`/`SkeletonRow` and `EmptyState`. Every skeleton must mirror the shape of the content it replaces, so nothing jumps when real data lands.

- [ ] **Step 1:** Replace the bare `"Loading channel…"` / `"Loading…"` / `"Channel not found."` strings with skeletons and proper empty states.
- [ ] **Step 2:** `MessageList` — skeleton message rows while profiles resolve. Remove the `"…"` placeholder author name; render a name-width skeleton instead.
- [ ] **Step 3:** Empty states with a short line of copy and, where there is an obvious next action, a button: empty channel ("No messages yet — say something"), no DMs, no servers in the rail, empty member list, no search results.
- [ ] **Step 4:** Error states — channel not found, profile not found, invalid/expired invite — get an `EmptyState` with a way back, not bare muted text.
- [ ] **Step 5:** Verify per G9 and commit.

---

## Task 9: Detail fixes

**Files:** Modify `src/components/messages/MessageItem.tsx`, `src/components/messages/MessageContent.tsx`, `src/app/(app)/channels/[channelId]/page.tsx`

- [ ] **Step 1: Mention vs. flash.** `MessageItem` currently renders both "mentions you" and "search-jump flash" as `bg-amber/10 border-l-2 border-amber`, so a jumped-to search result looks like a ping. Keep amber for mentions. Give the flash its own treatment in `accent` that fades out over its existing 2s window. When a message is both mentioned and flashed, the mention styling wins.
- [ ] **Step 2: Image layout shift.** Per G7 the element stays an `<img>`. Wrap attachment images in a fixed-size container (`h-80 max-w-sm` with `object-contain` on a `bg-surface-2` ground, `rounded-control`) so the row reserves its space before the image loads. Small images must not be stretched.
- [ ] **Step 3: Channel header.** Replace the literal `"# "` with the Phosphor `Hash` icon, matching Task 5's sidebar treatment. Add a subtle bottom shadow to the header so it separates from the scrolling message list.
- [ ] **Step 4:** Verify per G9 and commit.

---

## Task 10: Token normalization sweep

**Files:** Modify `src/components/messages/ForwardedBlock.tsx`, `MentionAutocomplete.tsx`, `MessageDropZone.tsx`, `PinnedPanel.tsx`, `ReactionBar.tsx`, `src/components/servers/MessageSearchPanel.tsx`, `Pagination.tsx`, `RoleEditor.tsx`, `RolePill.tsx`, `SearchSuggestions.tsx`, `ServerIcon.tsx`, `src/components/ui/Dropdown.tsx`, `src/components/user/StatusBubble.tsx`, `src/components/user/settings/AccountSection.tsx`, `src/components/user/settings/ProfileSection.tsx`

These 15 files render styled UI but were untouched by Tasks 1–9. Without this sweep the new radius and type tokens apply to only part of the app, leaving it **less** consistent than before the overhaul.

- [ ] **Step 1:** Apply the Canonical Token Map to every one of the 15 files. Replace ad-hoc `rounded*` and `text-[11px]` / `text-xs` / `text-sm` with the semantic tokens.
- [ ] **Step 2:** This is an appearance-only pass (G5). Do not change props, handlers, data flow, or layout structure. Sizing/spacing classes stay as they are unless a radius token requires an adjacent change.
- [ ] **Step 3:** Every file in the list must appear in the diff. A file with no change is a missed requirement — if one genuinely needs no change, say so explicitly in the report with the reason.
- [ ] **Step 4:** Verify per G9 and commit.

---

## Task 11: Branding, auth pages, icon and OG image

**Files:** Modify `src/app/login/page.tsx`, `src/app/register/page.tsx`; create `src/app/icon.svg`, `src/app/opengraph-image.tsx`

- [ ] **Step 1:** Read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/app-icons.md` and `opengraph-image.md` before writing either file.
- [ ] **Step 2: `src/app/icon.svg`.** A simple, legible mark that works at 16px — a geometric chat/speech form in the app's accent, not a letterform and not clip-art. `app/favicon.ico` already exists and stays; `icon.svg` coexists with it and modern browsers prefer the SVG.
- [ ] **Step 3: `src/app/opengraph-image.tsx`.** Generated with `ImageResponse` from `next/og`, exporting `size` (1200×630), `contentType`, and `alt`. **Per G1 the default export must be `async` and must `await` any `params`/`id` props** — Next.js 16 passes them as Promises. Design it in the app's own palette: product name, one line of description, the mark. No external fonts or remote image fetches.
- [ ] **Step 4: Auth pages.** Give `/login` and `/register` a real first impression: the mark and product name above the card, the card on `rounded-modal` with proper field labels and spacing, `autoComplete` attributes on the inputs (`email`, `current-password`, `new-password`), inline error text tied to its field via `aria-describedby`, and a disabled/busy button state. Keep the existing Supabase auth calls, the `safeNext` redirect logic, and the `Suspense` boundaries exactly as they are.
- [ ] **Step 5:** Verify per G9 and commit.
