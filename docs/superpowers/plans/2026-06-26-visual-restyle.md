# Visual Restyle ("Polished Dark") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the chat app to the "Polished Dark" look and centralize the palette into Tailwind v4 theme tokens, with no layout or behavior changes.

**Architecture:** Define the palette once as CSS variables in `globals.css`, exposed as Tailwind v4 utilities via `@theme inline` (so `--color-app` generates `bg-app`/`text-app`/`border-app`, etc.). Then swap every hardcoded Discord hex in the ~13 components + 3 page/layout files to the new token utilities, applying refinement conventions (larger radii, more padding, subtle borders). Pure-logic unit tests are unaffected.

**Tech Stack:** Next.js 16, Tailwind CSS v4 (`@tailwindcss/postcss`), TypeScript.

---

## Prerequisites

- [ ] **P1: Node on PATH** — `node --version` (v20+). If missing: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"`.

## Canonical Color Map (used by every component task)

Replace each **old hex** with the **new Tailwind utility**. The utility prefix depends on the CSS property: background→`bg-`, text→`text-`, border→`border-`. (The tokens are defined in Task 1.)

| Old hex | Role | New token | Example utilities |
|---|---|---|---|
| `#313338` | main chat bg | `app` | `bg-app` |
| `#2b2d31` | sidebar surface | `sidebar` | `bg-sidebar` |
| `#2b2d31` | popover/bar/card surface (non-sidebar) | `surface` | `bg-surface` |
| `#111214` | popover bg (autocomplete, pinned) | `sidebar` | `bg-sidebar` |
| `#383a40` | composer / textarea / edit input bg | `surface` | `bg-surface` |
| `#404249` | hover / active channel bg | `surface` | `hover:bg-surface`, `bg-surface` |
| `#1e1f22` | auth form inputs | `surface-2` | `bg-surface-2` |
| `#232428` | user-panel inset | `surface-2` | `bg-surface-2` |
| `#5865f2` | accent (links, primary btn, active) | `accent` | `bg-accent`, `text-accent` |
| `#dbdee1`, `#c9ccd1` | primary body text | `ink` | `text-ink` |
| `#949ba4`, `#6d6f78` | muted/secondary text | `muted` | `text-muted` |
| `#4e5058` | subtle border | `line` | `border-line` |
| `#faa61a` | "mentions you" amber | `amber` | `border-amber`, `text-amber`, `bg-amber/10` |
| `#3c4270` | mention-pill bg | `mention` | `bg-mention` |
| `#c9cdfb` | mention-pill text | `mention-ink` | `text-mention-ink` |
| `#ffffff` | hard white (keep) | — | `text-white` |
| `#3ba55d` (if any) | online dot | `online` | `bg-online` |

**Refinement conventions to apply while swapping (appearance only — never change JSX structure, props, or logic):**
- Containers/cards/popovers: use `rounded-xl` (was `rounded`/`rounded-lg`); keep existing shadows.
- Composer, inputs, panels, popovers: add `border border-line` if not already bordered.
- Replace any literal `border-black/30` / `border-white/10` dividers with `border-line`.
- Keep all existing layout classes (flex, sizing, gap) untouched; only colors, radius, and border refinements change.

---

## Task 1: Define theme tokens + clean globals + base layout

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Replace the entire contents of `src/app/globals.css`** with:

```css
@import "tailwindcss";

@theme inline {
  --color-app: #1a1b1e;
  --color-sidebar: #141517;
  --color-surface: #26282c;
  --color-surface-2: #0f1012;
  --color-line: rgba(255, 255, 255, 0.07);
  --color-ink: #f2f3f5;
  --color-muted: #9aa0a8;
  --color-accent: #7c9cff;
  --color-accent-strong: #5b7cff;
  --color-mention: #2b3565;
  --color-mention-ink: #b9c5ff;
  --color-amber: #f0b86b;
  --color-danger: #f87171;
  --color-online: #3ba55d;
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}

body {
  background: var(--color-app);
  color: var(--color-ink);
  font-family: var(--font-sans);
}
```

(This drops the old create-next-app `--background`/`--foreground` vars and the Arial body font.)

- [ ] **Step 2: Update `src/app/layout.tsx`** body classes to the new tokens. The current body line is:
```tsx
      <body className="bg-[#313338] text-[#dbdee1] antialiased">
```
Replace it with:
```tsx
      <body className="bg-app text-ink antialiased">
```
Leave the rest of the file (imports, `AuthProvider` wrap, metadata) unchanged.

- [ ] **Step 3: Verify the tokens generate utilities + build is green**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/mallow/projects/website && npm run build`
Expected: success. If the build errors that `bg-app`/`text-ink` are unknown utilities, the `@theme inline` block is wrong — re-check it against the installed Tailwind v4 behavior (each `--color-x` must generate `bg-x`/`text-x`/`border-x`). Do NOT proceed until `bg-app`/`text-ink` resolve.

- [ ] **Step 4: Commit**
```bash
git add src/app/globals.css src/app/layout.tsx
git commit -m "feat: add Polished Dark theme tokens; drop create-next-app defaults"
```

---

## Task 2: Restyle auth pages

**Files:**
- Modify: `src/app/login/page.tsx`
- Modify: `src/app/register/page.tsx`

- [ ] **Step 1: Apply the Canonical Color Map to both files.** Read each file; replace every `#hex` Tailwind arbitrary value (e.g. `bg-[#2b2d31]`, `bg-[#1e1f22]`, `text-[#949ba4]`, `text-[#5865f2]`, `text-red-400`) with the mapped token utility:
  - card container `bg-[#2b2d31]` → `bg-surface` and add `border border-line`, use `rounded-xl`
  - inputs `bg-[#1e1f22]` → `bg-surface-2`, use `rounded-lg`
  - primary button `bg-[#5865f2]` → `bg-accent`, and `hover:bg-accent-strong`; `rounded-lg`
  - link text `text-[#5865f2]` → `text-accent`
  - helper text `text-[#949ba4]` → `text-muted`
  - error text `text-red-400` → `text-danger`
  Do NOT change any form logic, state, handlers, or JSX structure — only className colors/radius/border.

- [ ] **Step 2: Verify build** — `npm run build`. Expected: success.

- [ ] **Step 3: Commit**
```bash
git add src/app/login/page.tsx src/app/register/page.tsx
git commit -m "style: restyle auth pages to theme tokens"
```

---

## Task 3: Restyle sidebar, app shell, and New-DM dialog

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/components/NewDmDialog.tsx`

- [ ] **Step 1: Apply the Canonical Color Map.** Read each file; swap hex → tokens by role:
  - `Sidebar.tsx`: outer aside `bg-[#2b2d31]` → `bg-sidebar`; channel hover/active `hover:bg-[#404249]`/`bg-[#404249]` → `hover:bg-surface`/`bg-surface`; user panel `bg-[#232428]` → `bg-surface-2` with `rounded-xl`; muted text `text-[#949ba4]` → `text-muted`; white/active text stays `text-white`; the `border-black/30` divider → `border-line`.
  - `(app)/layout.tsx`: the "Loading…" `text-[#949ba4]` → `text-muted`. (Layout flex classes unchanged.)
  - `NewDmDialog.tsx`: modal panel `bg-[#2b2d31]` → `bg-surface` + `border border-line` + `rounded-xl`; search input `bg-[#1e1f22]` → `bg-surface-2` `rounded-lg`; result hover `hover:bg-[#404249]` → `hover:bg-surface`; muted text → `text-muted`; trigger `text-[#949ba4] hover:text-white` → `text-muted hover:text-ink`.
  Only colors/radius/border change; keep all logic, queries, and structure.

- [ ] **Step 2: Verify build** — `npm run build`. Expected: success.

- [ ] **Step 3: Commit**
```bash
git add src/components/Sidebar.tsx "src/app/(app)/layout.tsx" src/components/NewDmDialog.tsx
git commit -m "style: restyle sidebar, app shell, and new-DM dialog to theme tokens"
```

---

## Task 4: Restyle message display components

**Files:**
- Modify: `src/components/MessageItem.tsx`
- Modify: `src/components/MessageContent.tsx`
- Modify: `src/components/MessageActions.tsx`
- Modify: `src/components/ReactionBar.tsx`

- [ ] **Step 1: Apply the Canonical Color Map.** Read each file; swap hex → tokens by role:
  - `MessageItem.tsx`: author name stays `text-white`; timestamp/muted `text-[#949ba4]` → `text-muted`; the mentions-you highlight `bg-[#faa61a]/10 border-l-2 border-[#faa61a]` → `bg-amber/10 border-l-2 border-amber`; reply-preview muted text → `text-muted`, the reply mention pill `bg-[#3c4270] text-[#c9cdfb]` → `bg-mention text-mention-ink`, plain reply name `text-[#c9ccd1]` → `text-ink`; edit textarea `bg-[#383a40] text-[#dbdee1]` → `bg-surface text-ink` `rounded-lg`; error `text-red-400` → `text-danger`; snippet/preview text → `text-ink`/`text-muted` as written.
  - `MessageContent.tsx`: body `text-[#dbdee1]` → `text-ink`; the mention-pill span `bg-[#3c4270] text-[#c9cdfb]` → `bg-mention text-mention-ink`; link `text-[#5865f2]` → `text-accent`; edited marker `text-[#949ba4]` → `text-muted`; headings keep sizes. (The image `<img>` and `isHttpUrl` logic stay untouched.)
  - `MessageActions.tsx`: bar `bg-[#2b2d31]` → `bg-surface` + `rounded-lg` + `border border-line`; buttons `text-[#949ba4] hover:text-white` → `text-muted hover:text-ink`.
  - `ReactionBar.tsx`: pill base `border-transparent bg-black/20` → `border-line bg-surface`; "mine" pill `border-[#5865f2] bg-[#5865f2]/20` → `border-accent bg-accent/15`; emoji picker buttons keep opacity behavior; any muted text → `text-muted`.
  Colors/radius/border only — never change the markdown pipeline, reaction toggle logic, or any handler.

- [ ] **Step 2: Verify build + tests** — `npm run build` then `npm test`. Expected: build success; 32 tests pass.

- [ ] **Step 3: Commit**
```bash
git add src/components/MessageItem.tsx src/components/MessageContent.tsx src/components/MessageActions.tsx src/components/ReactionBar.tsx
git commit -m "style: restyle message display to theme tokens"
```

---

## Task 5: Restyle composer, autocomplete, and pinned panel

**Files:**
- Modify: `src/components/MessageInput.tsx`
- Modify: `src/components/MentionAutocomplete.tsx`
- Modify: `src/components/PinnedPanel.tsx`

- [ ] **Step 1: Apply the Canonical Color Map.** Read each file; swap hex → tokens by role:
  - `MessageInput.tsx`: error `text-red-400` → `text-danger`; reply bar `bg-[#2b2d31]` → `bg-surface` `rounded-t-xl`; reply-name `text-[#c9ccd1]` → `text-ink`; the @ON toggle on-state `border-[#5865f2] bg-[#3c4270] text-[#c9cdfb]` → `border-accent bg-mention text-mention-ink`, off-state `border-[#4e5058] text-[#949ba4]` → `border-line text-muted`; cancel/attach buttons `text-[#949ba4] hover:text-white` → `text-muted hover:text-ink`; textarea `bg-[#383a40] text-[#dbdee1]` → `bg-surface text-ink` and use `rounded-xl` + `border border-line`.
  - `MentionAutocomplete.tsx`: dropdown `bg-[#111214] border-white/10` → `bg-sidebar border border-line` `rounded-xl`; row hover `hover:bg-[#404249] text-[#dbdee1]` → `hover:bg-surface text-ink`; the `@username` muted span → `text-muted`.
  - `PinnedPanel.tsx`: panel `bg-[#111214] border-white/10` → `bg-sidebar border border-line` `rounded-xl`; each pinned card `bg-[#2b2d31]` → `bg-surface` `rounded-lg`; title/white stays `text-white`/`text-ink`; muted + unpin `text-[#949ba4] hover:text-white` → `text-muted hover:text-ink`; body text `text-[#dbdee1]` → `text-ink`.
  Colors/radius/border only — never change caret logic, the mention query, the toggle_pin call, or structure.

- [ ] **Step 2: Verify build + tests** — `npm run build` then `npm test`. Expected: build success; 32 tests pass.

- [ ] **Step 3: Commit**
```bash
git add src/components/MessageInput.tsx src/components/MentionAutocomplete.tsx src/components/PinnedPanel.tsx
git commit -m "style: restyle composer, autocomplete, and pinned panel to theme tokens"
```

---

## Task 6: Final verification

**Files:** none (verification)

- [ ] **Step 1: Confirm no hardcoded Discord hex remain in components.**

Run:
```bash
cd /home/mallow/projects/website
grep -rnE '#(313338|2b2d31|1e1f22|404249|232428|5865f2|dbdee1|949ba4|3c4270|c9cdfb|faa61a|111214|383a40|6d6f78|4e5058|c9ccd1)' src/ || echo "CLEAN: no legacy hex remain"
```
Expected: `CLEAN: no legacy hex remain`. (The only hex left in the repo should be the token definitions in `globals.css`.) If any remain, restyle them per the Color Map before continuing.

- [ ] **Step 2: Full build + tests.**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/mallow/projects/website && npm run build && npm test`
Expected: build clean; 32 tests pass.

- [ ] **Step 3: Manual visual pass** (`npm run dev`, browser at http://localhost:3000):
  - Login + register pages: card, inputs, accent button, links all use the new palette.
  - Channel view: warmer charcoal bg, sidebar deeper, active channel highlighted, composer bordered/rounded.
  - Send a message with markdown + a mention → pill is periwinkle-tinted; link is accent.
  - Reply (quoted preview), the amber "mentions you" highlight on the other account, reaction pills (own one accent-tinted), edit mode, image inline.
  - Open the pinned panel and the @ autocomplete → both are rounded, bordered, dark popovers.
  - Nothing appears unstyled, default-blue, or white-on-white.
  - Stop the dev server when done.

- [ ] **Step 4: Done.** The app now uses the Polished Dark palette via theme tokens, with layout and features unchanged.

---

## Done Criteria

- Palette defined as tokens in `globals.css`; the grep in Task 6 reports no legacy hex in `src/`.
- All screens show the Polished Dark look; layout and all features behave exactly as before.
- `npm run build` and `npm test` pass; the manual visual checklist passes.
