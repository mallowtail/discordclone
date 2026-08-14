# User settings surface — design

**Date:** 2026-08-14
**Sub-project:** Settings surfaces (E). Slice **1 of 2** (**1 User settings** → 2 Server settings).
**Status:** approved, ready for planning

## Goal

Replace the cramped `ProfileDialog` modal with a full-screen, Discord-style **User Settings**
takeover: a left nav rail (sections + Log Out) and a wide content column. Two sections —
**Profile** and **Account** — that fill the real gaps: you currently cannot edit your display
name or change your password anywhere in the app.

## Decisions (from brainstorming)

- **Presentation:** full-screen takeover (`fixed inset-0 z-50 bg-app`), NOT a modal. Left nav
  rail (~220px) with section buttons and a red **Log Out** pinned at its bottom; wide content
  column; **✕** button (top-right) and **Escape** both close it. Default section on open =
  **Profile**.
- **Two sections only:** Profile, Account. No Privacy/Notifications/etc. (YAGNI for 30 friends).
- **Username stays read-only** — it is the `@handle` used for mentions (validated at register);
  editing it (uniqueness collisions, RLS) is out of scope. **Display name** becomes editable —
  this is the real gap (today `display_name` silently equals the username, set once at register).
- **Account:** email is **read-only**; **change password** requires **current-password
  re-entry** (verify via re-auth, then update); **no email change, no delete account**.
- `ProfileDialog.tsx` is **deleted**; `UserPanel`'s avatar button opens the new surface. Log Out
  moves out of `UserPanel` into the settings nav rail (the `UserPanel` avatar button is the only
  thing left there — it now opens settings instead of the old dialog).

## Components

### `src/lib/profile.ts` — add a constant + validator (tested)
- Add `export const DISPLAY_MAX = 32;`.
- Add a pure validator used by the Profile section:
  ```ts
  /** Trimmed display name; ok only when non-empty and within DISPLAY_MAX. */
  export function validateDisplayName(input: string):
    { ok: true; value: string } | { ok: false; error: string } {
    const trimmed = input.trim();
    if (trimmed.length === 0) return { ok: false, error: "Display name can't be empty" };
    if (trimmed.length > DISPLAY_MAX) return { ok: false, error: `Keep it under ${DISPLAY_MAX} characters` };
    return { ok: true, value: trimmed };
  }
  ```
  (`clampProfileText` continues to handle status/bio.)

### `src/components/user/UserSettings.tsx` — the shell
- Props: `{ onClose: () => void }`.
- State: `section: "profile" | "account"` (default `"profile"`).
- Layout: `fixed inset-0 z-50 bg-app flex`. Left rail `w-56 bg-sidebar` with:
  - a small `text-[11px] font-semibold uppercase tracking-wider text-muted` "User Settings" label,
  - two nav buttons (Profile, Account) — active one highlighted (`bg-surface-2 text-ink`,
    inactive `text-muted hover:text-ink`),
  - a spacer, then a red **Log Out** button pinned at the bottom (`mt-auto`), which calls
    `signOut()` then `router.replace("/login")` (logic moved from `UserPanel`).
  - Content column `flex-1 relative overflow-y-auto`, max content width ~`max-w-xl` with padding.
  - **✕** close button top-right of the content column.
- Escape closes: a `useEffect` keydown listener calling `onClose` on `"Escape"`.
- Renders `<ProfileSection />` or `<AccountSection />` by `section`.

### `src/components/user/settings/ProfileSection.tsx`
Self-contained; uses `useAuth()` (`user`, `profile`, `refreshProfile`) + `createClient()`.
- Avatar row: `Avatar` (size `lg`) + "Upload image" button → hidden `input[type=file] accept="image/*"`
  → `uploadAvatar(file)` then `profiles.update({ avatar_url })` `.eq("id", user.id)` → `refreshProfile()`.
  (Same logic lifted from the old `ProfileDialog`; avatar saves immediately on upload.)
- **Display name** input (`defaultValue`/controlled from `profile.display_name`, `maxLength={DISPLAY_MAX}`).
- **Username** shown read-only: the `@{profile.username}` value in a disabled-looking field, with a
  muted note "This is your @handle — people use it to mention you."
- **Status** input (`maxLength={STATUS_MAX}`), **Bio** textarea (`maxLength={BIO_MAX}`, char counter).
- One **Save** button: run `validateDisplayName(name)`; on error show it inline and stop. On ok,
  `profiles.update({ display_name: value, status: clampProfileText(status, STATUS_MAX),
  bio: clampProfileText(bio, BIO_MAX) })` `.eq("id", user.id)` → `refreshProfile()` → inline
  "Saved" confirmation (no auto-close — it's a full page, not a modal). Busy/disabled while saving.

### `src/components/user/settings/AccountSection.tsx`
Self-contained; uses `useAuth()` (`user`) + `createClient()`.
- **Email** — read-only display of `user.email` (muted, in a disabled field). Note: "Email can't
  be changed here."
- **Change password** form: three fields — **Current password**, **New password**,
  **Confirm new password** (all `type="password"`).
  - Validate: new length ≥ 8; new === confirm; else inline error, no network call.
  - Verify current: `supabase.auth.signInWithPassword({ email: user.email, password: current })`.
    On error → inline "Current password is incorrect", stop (password unchanged).
  - On success: `supabase.auth.updateUser({ password: newPassword })`. On error → inline
    "Couldn't update password — try again". On success → clear the three fields + inline
    "Password updated". Busy/disabled during the round-trip.

### `src/components/user/UserPanel.tsx` — rewire
- Replace `ProfileDialog` import/usage with `UserSettings`.
- The avatar button opens `UserSettings` (`showSettings`), same as before it opened the dialog.
- **Remove** the inline "Log out" button + `onSignOut` (Log Out now lives in the settings rail).
  `UserPanel` keeps only the avatar + display-name button opening settings.

### Delete
- `src/components/user/ProfileDialog.tsx` — removed (its logic is absorbed into `ProfileSection`).

## Non-goals

- No username editing (uniqueness/RLS — out of scope).
- No email change, no delete account (needs a service-role Edge Function — deferred).
- No Privacy / Notifications / Appearance / Voice sections.
- No changes to Server settings (that's slice 2).
- No new migration, dependency, or env change — all client-side against existing tables/auth.

## Testing

- **Unit** (`tests/profile.test.ts` or extend existing): `validateDisplayName` — trims;
  empty/whitespace → error; over `DISPLAY_MAX` → error; normal → `{ ok: true, value }`.
- **Build:** `npm run build` clean; `npx vitest run` green (adds the display-name tests).
- **Manual:**
  - Rename yourself in Profile → Save → your new display name appears in chat author names, the
    member list, and the profile card (all read `display_name`).
  - Username field is not editable; email field is not editable.
  - Change password: wrong current password → "Current password is incorrect", nothing changes;
    mismatched confirm → inline error, no call; correct current + valid new → "Password updated";
    log out and log back in with the **new** password succeeds.
  - Escape and ✕ both close the surface; Log Out (in the rail) signs out and routes to /login.

## Operational note

No migration, no dependency, no env change. Front-end branch. Uses existing `profiles` table
(RLS: users update their own row — already in place) and Supabase Auth
(`signInWithPassword` / `updateUser`) for the session user.
