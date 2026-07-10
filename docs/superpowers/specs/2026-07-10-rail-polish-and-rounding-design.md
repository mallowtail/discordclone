# Rail polish + softer corners — design

**Date:** 2026-07-10
**Sub-project:** Aesthetics pass, slice 1 of 2 (slice 2 = profile cards + bio/status)
**Status:** approved, ready for planning

## Goal

Make the app feel less like a prototype: give the server rail Discord's signature
left-edge **pill indicator** and a styled **name flyout** on hover, and soften the
app's corners a notch. Pure front-end — no schema, no new dependencies.

## Decisions (from brainstorming)

- Server rail gets a left-edge pill: hidden by default → small dot on hover → tall pill
  when that item is active. This **replaces** the current `ring-2 ring-accent` active style.
- Hovering a rail item shows the item's name in a styled dark flyout to the **right** of
  the rail, replacing the native browser `title` tooltip.
- "Less square-y": bump the radius a notch on the main surfaces (dialogs, inputs,
  composer, buttons) and add smooth transitions on the rail. Small chips (reaction pills,
  mention pills) stay as-is so they don't turn into blobs.

## Current state (what we're changing)

- `src/components/servers/ServerRail.tsx` — a 72px column with three near-duplicate button
  blocks (DMs `💬`, each server icon, `+` add). Active server = `ring-2 ring-accent`;
  tooltips = native `title`. The DMs/`+` buttons already do a `rounded-full → rounded-2xl`
  hover morph; server icons do not.
- `src/components/servers/ServerIcon.tsx` — always `rounded-2xl`. Unchanged by this slice.
- Radii in use: `rounded-lg` (inputs/buttons/message rows), `rounded-xl` (dialog cards,
  auth forms), `rounded-2xl` (server icons). Avatars are already `rounded-full`.

## Architecture

### 1. `RailItem` wrapper (new, in `ServerRail.tsx`)

Extract the repeated rail-button markup into one small presentational component so the
pill + flyout logic lives in a single place (the file currently repeats it three times):

```tsx
function RailItem({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="group relative flex items-center justify-center w-full">
      {/* left-edge pill: hidden → dot on hover → tall pill when active */}
      <span
        className={`absolute left-0 w-1 rounded-r-full bg-ink transition-all duration-200 ${
          active ? "h-10" : "h-0 group-hover:h-2.5"
        }`}
      />
      <button onClick={onClick} className="transition-transform">
        {children}
      </button>
      {/* name flyout to the right */}
      <span
        className="pointer-events-none absolute left-full ml-3 z-50 hidden whitespace-nowrap rounded-lg bg-app px-2 py-1 text-sm text-ink shadow-lg group-hover:block"
      >
        {label}
      </span>
    </div>
  );
}
```

`ServerRail` renders `RailItem` for each entry:
- Home/DMs: `active={activeServerId === null}`, `label="Direct Messages"`, child = the `💬`
  bubble (keep its `bg-accent` when active vs `bg-surface` idle look).
- Each server: `active={activeServerId === s.id}`, `label={s.name}`, child = `<ServerIcon>`.
- Add: `active={false}`, `label="Add a server"`, child = the `+` bubble.

Remove all `title=` attributes (the flyout replaces them) and the `ring-2 ring-accent`
active style (the pill replaces it). Keep the divider between Home and the server list.

Exact pixel values (pill offset, dot height) are the plan's to finalize; the required
**behavior** is: nothing at rest, an ~8–10px dot on hover, a ~40px pill when active, all
animated via `transition-all`.

### 2. Softer corners

A measured one-notch bump, applied by editing the relevant className strings:

- **Dialog cards** `rounded-xl` → `rounded-2xl`: AddServerDialog, ServerSettingsDialog,
  InviteDialog, NewDmDialog, ProfileDialog, CreateChannelDialog, and the login/register
  form cards.
- **Inputs, the message composer textarea, and buttons** `rounded-lg` → `rounded-xl`
  across the dialogs/forms/composer above and the primary action buttons.
- **Leave as-is:** reaction pills (`ReactionBar`), mention pills, and any element already
  `rounded-full` or `rounded-2xl`. The goal is softer, not rounder-everywhere.

The plan will enumerate the exact files/lines; the rule above governs which class maps to
which.

## Non-goals (YAGNI)

- No unread-badge state on the rail (we have no unread tracking) — pill has only
  hidden/hover/active states.
- No circle→squircle icon morph on server icons (the pill is the indicator); the existing
  DMs/`+` morph stays as it is.
- No theme-token restructuring — this is class-level edits, not a new radius scale.

## Testing

This slice is presentational; there is no meaningful unit-test surface (the pill is
CSS-state-driven, `RailItem` is a pure wrapper). Verification is:

1. `npm run build` succeeds and `npx vitest run` still passes (no regressions — existing
   tests must stay green).
2. Manual visual check: (a) hovering a rail item shows an ~8px dot on the left and the
   name flyout on the right; (b) the active server shows a tall pill and no ring; (c)
   dialogs, inputs, and the composer have visibly softer corners; (d) nothing overlaps or
   clips at the rail's right edge.

## Operational note

No migration, no new dependency, no env change. Ships as a normal front-end branch.
