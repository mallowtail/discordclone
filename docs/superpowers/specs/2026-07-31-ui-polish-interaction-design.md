# UI polish 3 — interaction & focus states — design

**Date:** 2026-07-31
**Sub-project:** Taste-driven UI polish (Design Read B), slice 3 of 3 (1 icons ✅ → 2 typography ✅ → **3 interaction/focus**).
**Status:** approved, ready for planning

## Goal

Add the missing interaction layer: a real keyboard **focus ring** (currently invisible — an
a11y gap), a **pointer cursor** on clickables (Tailwind doesn't add it to `<button>`), smooth
**transitions**, and subtle **tactile press** — all under a `prefers-reduced-motion` guard.
Implemented mostly as one **base layer in `globals.css`**, so it applies everywhere with
near-zero component churn.

## Decisions (from the audit + user request)

- Keyboard focus is invisible today → global `:focus-visible` accent ring (WCAG a11y win).
- Buttons don't show a pointer cursor → add `cursor: pointer` to clickables.
- Hovers snap inconsistently → one consistent `transition`.
- Subtle `active:` press for physical feedback.
- Everything collapses to instant under reduced motion.
- **Not in scope:** micro-depth / shadows / elevation (subjective, higher churn — possible
  follow-up).

## Implementation

### 1. `src/app/globals.css` — add a base layer (Tailwind v4)

Append after the existing `body {}` rule:

```css
@layer base {
  /* Keyboard focus ring (accessibility). Utilities like `outline-none` still win where set
     intentionally, e.g. the message composer/edit textareas. */
  :focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
    border-radius: 2px;
  }

  /* Clickables get a pointer cursor. */
  button:not(:disabled),
  [role="button"],
  a[href],
  summary,
  label[for] {
    cursor: pointer;
  }
  button:disabled {
    cursor: not-allowed;
  }

  /* Smooth, consistent interaction transitions. */
  button,
  a,
  input,
  textarea,
  select,
  [role="button"] {
    transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease,
      opacity 0.15s ease, transform 0.1s ease;
  }

  /* Subtle tactile press. */
  button:not(:disabled):active {
    transform: translateY(0.5px);
  }

  @media (prefers-reduced-motion: reduce) {
    button,
    a,
    input,
    textarea,
    select,
    [role="button"] {
      transition: none;
    }
    button:not(:disabled):active {
      transform: none;
    }
  }
}
```

Notes:
- `label[for]` only targets labels bound to a control (not decorative labels).
- Do NOT transition `height`/`width` — keep the composer textarea auto-grow snappy (it sets
  `style.height` directly; not in the transition list).
- The focus ring's `outline` respects each element's `border-radius` in modern browsers.

### 2. Non-`<button>` clickables — add `cursor-pointer`

A few interactive elements are `<div onClick>` / `<span onClick>` (they won't match the CSS
`button` rule). Grep `onClick` across `src/**/*.tsx` and add the Tailwind `cursor-pointer`
class to any `<div>` / `<span>` that has an `onClick` and isn't already a button. Known spots:
`MessageItem` reply-jump (`jumpToOriginal`) and reply indicator, `DmSidebar` DM-avatar span.
(Do not add it to overlay backdrops whose only onClick is close-on-click — those aren't
"buttons"; leave those as-is.)

## Explicitly not changed

- The composer & message-edit textareas keep `outline-none` (no ring while typing — the bar
  is the focus context). The global `:focus-visible` is overridden there by that utility, as
  intended.
- No shadows/elevation/depth changes. No color/type/icon changes.

## Testing

- `npm run build` succeeds; `npx vitest run` stays green (82).
- Manual: **Tab** through the app — every button/link/input shows a clear accent focus ring;
  hovering any button/link shows a pointer cursor; buttons give a subtle press on click;
  hovers feel smooth. With OS "reduce motion" on, transitions/press are instant. The composer
  textarea shows no focus outline while typing (intended).

## Operational note

No migration, no dependency, no env change. Front-end branch.
