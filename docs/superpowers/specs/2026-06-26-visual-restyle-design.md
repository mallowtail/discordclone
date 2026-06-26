# Visual Restyle — "Polished Dark"

**Date:** 2026-06-26
**Status:** Approved design, ready for implementation planning

## Context

The chat app (Foundation + rich messaging + replies/mentions/pins, all merged) currently
uses Discord's exact color palette **hardcoded as hex values** in ~13 components (~80
occurrences), and `src/app/globals.css` still carries leftover create-next-app defaults
(unused `--background`/`--foreground` vars, an Arial `body` font). The look is a literal
Discord clone and the colors are scattered, making restyling tedious.

The user wants the design to be more visually appealing. From four explored directions
(Polished Dark, Warm & Cozy, Clean Light, Vibrant Playful) the user chose **Polished
Dark**: the familiar layout refined with a calmer palette, softer accent, more breathing
room, and clearer depth.

## Goal

Restyle the app to the "Polished Dark" look, and centralize the palette into theme tokens
so future tweaks are trivial. **No layout or behavior changes** — every feature stays
exactly as built; only appearance changes.

## Scope

### In scope
- Define the palette once as CSS variables in `globals.css`, exposed as Tailwind v4 theme
  tokens via `@theme inline` so components can use semantic classes (e.g. `bg-surface`,
  `text-muted`, `text-accent`).
- Remove the dead create-next-app defaults from `globals.css` (the unused
  `--background`/`--foreground` and the Arial `body` font-family; keep a system-ui stack).
- Update the ~13 components to reference the new tokens instead of hardcoded hex.
- Apply the Polished Dark refinements: warmer charcoal surfaces, periwinkle accent, larger
  corner radii, more padding/line-height, consistent subtle borders.

### Out of scope
- Any layout change, new component, or behavior change.
- A light-mode toggle (tokens make it easy to add later, but it is not built now).
- Logic, data, RLS, tests of behavior (the existing unit tests are pure logic and are
  unaffected).

## Palette (the tokens)

Defined in `:root` in `globals.css` and mapped to Tailwind colors via `@theme inline`.

| Token | Value | Use |
|---|---|---|
| `--color-app` | `#1a1b1e` | main chat background |
| `--color-sidebar` | `#141517` | sidebar / deepest surface |
| `--color-surface` | `#26282c` | elevated: hover, composer, inputs, cards |
| `--color-surface-2` | `#0f1012` | inset (e.g. user panel) |
| `--color-line` | `rgba(255,255,255,0.07)` | borders / dividers |
| `--color-text` | `#f2f3f5` | primary text |
| `--color-text-muted` | `#9aa0a8` | secondary text |
| `--color-accent` | `#7c9cff` | links, active states, primary buttons |
| `--color-accent-strong` | `#5b7cff` | accent hover/pressed |
| `--color-mention` | `#2b3565` | mention-pill background |
| `--color-mention-text` | `#b9c5ff` | mention-pill text |
| `--color-amber` | `#f0b86b` | "mentions you" highlight |
| `--color-danger` | `#f87171` | error text |
| `--color-online` | `#3ba55d` | presence dot |

Mapping in `@theme inline` gives Tailwind utilities like `bg-app`, `bg-sidebar`,
`bg-surface`, `border-line`, `text-default`, `text-muted`, `text-accent`,
`bg-mention`, etc. (exact utility names finalized in the plan).

### Refinement conventions
- **Radii:** containers/cards `rounded-xl`; pills/buttons `rounded-lg`/`rounded-full`.
- **Spacing:** more generous padding on header, composer, message rows; slightly larger
  line-height in message bodies.
- **Depth:** 1px `border-line` on the composer, panels, and pinned/autocomplete popovers;
  keep the existing soft shadows on popovers.
- **Accent usage:** links, the reply @ON pill, active channel, and "my" reaction pill use
  the periwinkle accent; the amber stays for the mentions-you highlight.

## Affected files (appearance only)

- `src/app/globals.css` — define tokens, drop create-next-app defaults, set system-ui font.
- `src/app/layout.tsx` — body classes use the new tokens.
- Components restyled to tokens: `Sidebar`, `MessageList`, `MessageItem`, `MessageContent`,
  `MessageActions`, `MessageInput`, `MentionAutocomplete`, `PinnedPanel`, `ReactionBar`,
  `NewDmDialog`, and the `login` / `register` pages.

Each file's change is a like-for-like swap of hardcoded hex → token utility, plus the
radius/padding refinements. No JSX structure or props change.

## Approach Notes

- Tailwind v4 is already in use (`@import "tailwindcss"` in `globals.css`). Tokens are
  added with `@theme inline { --color-...: var(--...) }`, which generates the matching
  `bg-*`/`text-*`/`border-*` utilities. This is the idiomatic v4 way and avoids a config
  file. (Verify exact `@theme` token→utility behavior against the installed Tailwind v4
  docs during implementation.)
- Work component-by-component so each step builds and is visually checkable.

## Error Handling / Testing

- No runtime behavior changes, so no new automated tests.
- Verification is visual: after the token setup and each component pass, `npm run build`
  must stay green, and a final manual pass in the browser confirms every screen
  (login, register, channel, DM, pinned panel, autocomplete, reply bar, reactions,
  edit mode, image) looks correct and nothing is unstyled/regressed.
- Existing unit tests (pure logic) must continue to pass untouched.

## Done Criteria

- The palette lives in `globals.css` as tokens; no hardcoded Discord hex remain in
  components (spot-checked via grep).
- The app shows the Polished Dark look across all screens; layout and features unchanged.
- `npm run build` and `npm test` pass; the manual visual checklist passes.

## Roadmap Note

This is a standalone polish pass, not part of the feature roadmap. After it, remaining
rich-messaging features (threads, link previews, non-image files, full emoji picker) and
sub-project #3 (server management) continue as before.
