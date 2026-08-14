# User Settings Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cramped `ProfileDialog` modal with a full-screen Discord-style User Settings takeover with a Profile section (editable display name, avatar, read-only username, status, bio) and an Account section (read-only email, change-password with current-password re-entry).

**Architecture:** A full-screen overlay shell (`UserSettings`) renders a left nav rail (section switch + Log Out) and swaps between two self-contained panel components (`ProfileSection`, `AccountSection`). Both panels read/write through the existing `useAuth()` context and `createClient()` Supabase client; no new backend. A pure `validateDisplayName` helper is unit-tested; the rest is wiring existing patterns.

**Tech Stack:** Next.js 16 (App Router, client components), TypeScript, Tailwind v4 tokens, Supabase JS (`profiles` table + `auth.signInWithPassword`/`auth.updateUser`), Vitest.

## Global Constraints

- **No migration, no new dependency, no env change** — client-side only against existing tables/auth.
- **Username is read-only** (the `@handle`); **display name** is the editable field.
- **Email is read-only**; **no email change, no delete account**.
- Password change **requires current-password re-entry**, verified via `signInWithPassword` before `updateUser`.
- Full-screen takeover, not a modal: `fixed inset-0 z-50 bg-app`. Default section = **Profile**. **Escape** and **✕** both close.
- Use existing tokens only (`bg-app`, `bg-sidebar`, `bg-surface`, `bg-surface-2`, `text-ink`, `text-muted`, `border-line`, `bg-accent`/`hover:bg-accent-strong`, `text-danger`). Match the codebase's existing dialog/input class idioms (rounded-xl inputs `bg-surface-2 text-ink`, accent primary buttons).
- Password minimum length: **8** characters.

---

### Task 1: `validateDisplayName` helper + `DISPLAY_MAX` (pure, TDD)

**Files:**
- Modify: `src/lib/profile.ts`
- Test: `tests/profile.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `export const DISPLAY_MAX = 32;`
  - `export function validateDisplayName(input: string): { ok: true; value: string } | { ok: false; error: string }`

- [ ] **Step 1: Write the failing tests**

Append to `tests/profile.test.ts` (keep existing imports; add `DISPLAY_MAX, validateDisplayName` to the `@/lib/profile` import):

```ts
import { describe, it, expect } from "vitest";
import { DISPLAY_MAX, validateDisplayName } from "@/lib/profile";

describe("validateDisplayName", () => {
  it("trims and accepts a normal name", () => {
    expect(validateDisplayName("  Alex  ")).toEqual({ ok: true, value: "Alex" });
  });
  it("rejects empty / whitespace-only", () => {
    expect(validateDisplayName("   ")).toEqual({ ok: false, error: "Display name can't be empty" });
  });
  it("rejects over DISPLAY_MAX characters", () => {
    const res = validateDisplayName("x".repeat(DISPLAY_MAX + 1));
    expect(res.ok).toBe(false);
  });
  it("accepts exactly DISPLAY_MAX characters", () => {
    const name = "x".repeat(DISPLAY_MAX);
    expect(validateDisplayName(name)).toEqual({ ok: true, value: name });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/profile.test.ts`
Expected: FAIL — `validateDisplayName`/`DISPLAY_MAX` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/profile.ts`:

```ts
export const DISPLAY_MAX = 32;

/** Trimmed display name; ok only when non-empty and within DISPLAY_MAX. */
export function validateDisplayName(
  input: string
): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, error: "Display name can't be empty" };
  if (trimmed.length > DISPLAY_MAX) return { ok: false, error: `Keep it under ${DISPLAY_MAX} characters` };
  return { ok: true, value: trimmed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/profile.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/profile.ts tests/profile.test.ts
git commit -m "feat: validateDisplayName + DISPLAY_MAX helper (TDD)"
```

---

### Task 2: `ProfileSection` panel

**Files:**
- Create: `src/components/user/settings/ProfileSection.tsx`

**Interfaces:**
- Consumes: `useAuth()` → `{ user, profile, refreshProfile }`; `createClient()`; `uploadAvatar` from `@/lib/upload`; `Avatar` from `@/components/user/Avatar`; `clampProfileText, STATUS_MAX, BIO_MAX, DISPLAY_MAX, validateDisplayName` from `@/lib/profile`.
- Produces: `export function ProfileSection(): JSX.Element` — no props (self-contained).

This lifts the avatar/status/bio logic from the old `ProfileDialog` and adds display-name editing. There is no unit test (React panel wired to Supabase); it is covered by the build + manual testing at the end.

- [ ] **Step 1: Create the component**

Create `src/components/user/settings/ProfileSection.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { uploadAvatar } from "@/lib/upload";
import { Avatar } from "@/components/user/Avatar";
import {
  clampProfileText,
  validateDisplayName,
  STATUS_MAX,
  BIO_MAX,
  DISPLAY_MAX,
} from "@/lib/profile";

export function ProfileSection() {
  const supabase = createClient();
  const { user, profile, refreshProfile } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [name, setName] = useState(profile?.display_name ?? "");
  const [status, setStatus] = useState(profile?.status ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");

  async function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;
    setError(null);
    setBusy(true);
    const res = await uploadAvatar(file);
    if ("error" in res) {
      setBusy(false);
      return setError(res.error);
    }
    const { error: upErr } = await supabase
      .from("profiles")
      .update({ avatar_url: res.url })
      .eq("id", user.id);
    setBusy(false);
    if (upErr) return setError("Couldn't save — try again");
    await refreshProfile();
  }

  async function save() {
    if (!user) return;
    setSaved(false);
    const v = validateDisplayName(name);
    if (!v.ok) return setError(v.error);
    setError(null);
    setBusy(true);
    const { error: err } = await supabase
      .from("profiles")
      .update({
        display_name: v.value,
        status: clampProfileText(status, STATUS_MAX),
        bio: clampProfileText(bio, BIO_MAX),
      })
      .eq("id", user.id);
    setBusy(false);
    if (err) return setError("Couldn't save — try again");
    await refreshProfile();
    setSaved(true);
  }

  return (
    <div className="max-w-xl">
      <h2 className="text-[15px] font-semibold text-ink tracking-tight mb-4">Profile</h2>

      <div className="flex items-center gap-4 mb-5">
        <Avatar url={profile?.avatar_url ?? null} name={profile?.display_name} size="lg" />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="text-sm bg-accent hover:bg-accent-strong text-white rounded-xl px-3 py-1.5 disabled:opacity-50"
        >
          {busy ? "Working…" : "Upload image"}
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickAvatar} />
      </div>

      {error && <p className="text-danger text-sm mb-3">{error}</p>}
      {saved && <p className="text-online text-sm mb-3">Saved</p>}

      <div className="space-y-4">
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted">Display name</label>
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); setSaved(false); }}
            maxLength={DISPLAY_MAX}
            className="w-full p-2 rounded-xl bg-surface-2 text-ink text-sm mt-1"
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted">Username</label>
          <input
            value={profile ? `@${profile.username}` : ""}
            readOnly
            className="w-full p-2 rounded-xl bg-surface-2 text-muted text-sm mt-1 cursor-not-allowed"
          />
          <p className="text-muted text-xs mt-1">This is your @handle — people use it to mention you.</p>
        </div>

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted">Status</label>
          <input
            value={status}
            onChange={(e) => { setStatus(e.target.value); setSaved(false); }}
            maxLength={STATUS_MAX}
            placeholder="What's happening?"
            className="w-full p-2 rounded-xl bg-surface-2 text-ink text-sm mt-1"
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted">Bio</label>
          <textarea
            value={bio}
            onChange={(e) => { setBio(e.target.value); setSaved(false); }}
            maxLength={BIO_MAX}
            rows={3}
            placeholder="Tell people about yourself"
            className="w-full p-2 rounded-xl bg-surface-2 text-ink text-sm mt-1 resize-none"
          />
          <div className="text-muted text-[10px] text-right">{bio.length}/{BIO_MAX}</div>
        </div>

        <button
          onClick={save}
          disabled={busy}
          className="bg-accent hover:bg-accent-strong text-white font-medium rounded-xl px-5 py-2 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
```

Note: `text-online` is an existing token (green). If the build reports it missing, use `text-accent` instead.

- [ ] **Step 2: Typecheck/build compiles**

Run: `npx tsc --noEmit` (or defer to the Task 4 full build).
Expected: no type errors in this file.

- [ ] **Step 3: Commit**

```bash
git add src/components/user/settings/ProfileSection.tsx
git commit -m "feat: ProfileSection (editable display name + avatar/status/bio)"
```

---

### Task 3: `AccountSection` panel

**Files:**
- Create: `src/components/user/settings/AccountSection.tsx`

**Interfaces:**
- Consumes: `useAuth()` → `{ user }`; `createClient()`.
- Produces: `export function AccountSection(): JSX.Element` — no props.

Change-password flow: validate locally → re-auth with current password → `updateUser` with new password. No unit test (thin wrapper over Supabase auth); covered by manual testing.

- [ ] **Step 1: Create the component**

Create `src/components/user/settings/AccountSection.tsx`:

```tsx
"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";

const PASSWORD_MIN = 8;

export function AccountSection() {
  const supabase = createClient();
  const { user } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function changePassword() {
    setDone(false);
    setError(null);
    if (next.length < PASSWORD_MIN) return setError(`New password must be at least ${PASSWORD_MIN} characters`);
    if (next !== confirm) return setError("New passwords don't match");
    if (!user?.email) return setError("No email on this account");

    setBusy(true);
    // Verify the current password by re-authenticating.
    const { error: reauthErr } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: current,
    });
    if (reauthErr) {
      setBusy(false);
      return setError("Current password is incorrect");
    }
    const { error: updErr } = await supabase.auth.updateUser({ password: next });
    setBusy(false);
    if (updErr) return setError("Couldn't update password — try again");
    setCurrent("");
    setNext("");
    setConfirm("");
    setDone(true);
  }

  return (
    <div className="max-w-xl">
      <h2 className="text-[15px] font-semibold text-ink tracking-tight mb-4">Account</h2>

      <div className="mb-6">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-muted">Email</label>
        <input
          value={user?.email ?? ""}
          readOnly
          className="w-full p-2 rounded-xl bg-surface-2 text-muted text-sm mt-1 cursor-not-allowed"
        />
        <p className="text-muted text-xs mt-1">Email can't be changed here.</p>
      </div>

      <h3 className="text-[13px] font-semibold text-ink mb-3">Change password</h3>
      {error && <p className="text-danger text-sm mb-3">{error}</p>}
      {done && <p className="text-online text-sm mb-3">Password updated</p>}

      <div className="space-y-4">
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted">Current password</label>
          <input
            type="password"
            value={current}
            onChange={(e) => { setCurrent(e.target.value); setDone(false); }}
            className="w-full p-2 rounded-xl bg-surface-2 text-ink text-sm mt-1"
          />
        </div>
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted">New password</label>
          <input
            type="password"
            value={next}
            onChange={(e) => { setNext(e.target.value); setDone(false); }}
            className="w-full p-2 rounded-xl bg-surface-2 text-ink text-sm mt-1"
          />
        </div>
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted">Confirm new password</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => { setConfirm(e.target.value); setDone(false); }}
            className="w-full p-2 rounded-xl bg-surface-2 text-ink text-sm mt-1"
          />
        </div>
        <button
          onClick={changePassword}
          disabled={busy}
          className="bg-accent hover:bg-accent-strong text-white font-medium rounded-xl px-5 py-2 disabled:opacity-50"
        >
          {busy ? "Updating…" : "Update password"}
        </button>
      </div>
    </div>
  );
}
```

Note: `text-online` — same fallback note as Task 2 (`text-accent` if missing).

- [ ] **Step 2: Typecheck compiles**

Run: `npx tsc --noEmit`
Expected: no type errors in this file.

- [ ] **Step 3: Commit**

```bash
git add src/components/user/settings/AccountSection.tsx
git commit -m "feat: AccountSection (read-only email + change password w/ re-entry)"
```

---

### Task 4: `UserSettings` shell + rewire `UserPanel`, delete `ProfileDialog`

**Files:**
- Create: `src/components/user/UserSettings.tsx`
- Modify: `src/components/user/UserPanel.tsx`
- Delete: `src/components/user/ProfileDialog.tsx`

**Interfaces:**
- Consumes: `ProfileSection`, `AccountSection` (Tasks 2–3); `useAuth()` → `{ signOut }`; `useRouter` from `next/navigation`; Phosphor `X` icon (already a dependency, used elsewhere).
- Produces: `export function UserSettings({ onClose }: { onClose: () => void }): JSX.Element`.

- [ ] **Step 1: Create the shell**

Create `src/components/user/UserSettings.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { ProfileSection } from "@/components/user/settings/ProfileSection";
import { AccountSection } from "@/components/user/settings/AccountSection";
import { X } from "@phosphor-icons/react";

type Section = "profile" | "account";

export function UserSettings({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { signOut } = useAuth();
  const [section, setSection] = useState<Section>("profile");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function logOut() {
    await signOut();
    router.replace("/login");
  }

  const navItem = (id: Section, label: string) => (
    <button
      onClick={() => setSection(id)}
      className={`w-full text-left text-sm rounded-lg px-3 py-1.5 ${
        section === id ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 bg-app flex">
      <nav className="w-56 bg-sidebar border-r border-line flex flex-col p-3 gap-1">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted px-3 py-2">
          User Settings
        </div>
        {navItem("profile", "Profile")}
        {navItem("account", "Account")}
        <button
          onClick={logOut}
          className="mt-auto w-full text-left text-sm rounded-lg px-3 py-1.5 text-danger hover:bg-surface-2"
        >
          Log Out
        </button>
      </nav>

      <div className="flex-1 relative overflow-y-auto">
        <button
          onClick={onClose}
          title="Close (Esc)"
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-muted hover:text-ink hover:bg-surface-2"
        >
          <X size={18} weight="bold" />
        </button>
        <div className="p-8">
          {section === "profile" ? <ProfileSection /> : <AccountSection />}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Rewire `UserPanel`**

Replace the entire body of `src/components/user/UserPanel.tsx` with (removes the inline Log out button + `onSignOut`; avatar button opens `UserSettings`):

```tsx
"use client";

import { useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { Avatar } from "@/components/user/Avatar";
import { UserSettings } from "@/components/user/UserSettings";

export function UserPanel() {
  const { user, profile } = useAuth();
  const [showSettings, setShowSettings] = useState(false);

  return (
    <>
      <div className="p-2 bg-surface-2 rounded-2xl flex items-center text-sm">
        <button
          onClick={() => setShowSettings(true)}
          className="flex items-center gap-2 min-w-0 hover:opacity-80 w-full"
          title="User settings"
        >
          <Avatar url={profile?.avatar_url ?? null} name={profile?.display_name} size="sm" />
          <span className="text-ink truncate">{profile?.display_name ?? user?.email}</span>
        </button>
      </div>
      {showSettings && <UserSettings onClose={() => setShowSettings(false)} />}
    </>
  );
}
```

- [ ] **Step 3: Delete the old dialog and confirm nothing imports it**

```bash
git rm src/components/user/ProfileDialog.tsx
grep -rn "ProfileDialog" src   # expect: no output
```
Expected: `grep` prints nothing. If it prints a match, update that importer to use `UserSettings` (open it the same way `UserPanel` does).

- [ ] **Step 4: Build + full test suite**

Run: `npm run build && npx vitest run`
Expected: build succeeds; all tests pass (includes the new `validateDisplayName` cases). If the build errors on `text-online`, change the two `text-online` occurrences (ProfileSection, AccountSection) to `text-accent` and rebuild.

- [ ] **Step 5: Commit**

```bash
git add src/components/user/UserSettings.tsx src/components/user/UserPanel.tsx
git commit -m "feat: full-screen UserSettings shell; rewire UserPanel; drop ProfileDialog"
```

---

### Task 5: Manual verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the dev server and verify each behavior**

Start dev server (`npm run dev`), log in, open User Settings from the bottom-left avatar, and confirm:

1. **Opens on Profile**; left rail shows Profile / Account and a red Log Out at the bottom.
2. **Escape** closes; **✕** closes.
3. **Profile:** change the display name → Save → "Saved" shows; the new name appears in chat author names, the member list, and the profile card (all read `display_name`). Username field is not editable and shows `@handle`. Upload an avatar → it updates. Status/bio still save.
4. **Empty display name** → Save shows "Display name can't be empty" and does not persist.
5. **Account:** email field is read-only. Change password: wrong current → "Current password is incorrect" (nothing changes); mismatched confirm → "New passwords don't match" (no network call); new < 8 chars → length error; correct current + valid matching new → "Password updated".
6. **Log out** (from the rail) signs out and routes to `/login`; log back in with the **new** password succeeds.

- [ ] **Step 2: Note results**

Record pass/fail for each; if any fail, fix and re-verify before considering the slice complete.

---

## Self-Review

**Spec coverage:**
- Full-screen takeover + left rail + Log Out + ✕/Escape → Task 4 (`UserSettings`). ✓
- Editable display name + read-only username + avatar/status/bio → Task 2 (`ProfileSection`) + Task 1 (validator). ✓
- Read-only email + change password w/ current-password re-entry → Task 3 (`AccountSection`). ✓
- Delete `ProfileDialog`, rewire `UserPanel`, move Log Out out of panel → Task 4. ✓
- `DISPLAY_MAX` in `profile.ts` → Task 1. ✓
- Unit test for `validateDisplayName` → Task 1. ✓
- No migration/dep/env → all tasks client-side. ✓

**Placeholder scan:** No TBD/TODO; every component step has full code; test code is concrete.

**Type consistency:** `validateDisplayName` return shape used identically in Task 1 (test) and Task 2 (`v.ok`/`v.value`). `UserSettings({ onClose })` prop matches `UserPanel` usage. `ProfileSection`/`AccountSection` are prop-less and imported as named exports in Task 4. `useAuth()` fields (`user`, `profile`, `refreshProfile`, `signOut`) all exist in `AuthProvider`.
