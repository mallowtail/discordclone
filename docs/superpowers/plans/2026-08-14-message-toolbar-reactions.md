# Message Toolbar + Synced Recent-Emoji Reactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the per-message hover toolbar into `[recent 1][recent 2][recent 3] │ [pick any emoji] [reply] [⋯ more]`, back the recents with an account-synced list, and route all reactions through one shared path.

**Architecture:** A pure `recentEmojis.ts` helper (unit-tested, mirrors the SQL). A migration adds `profiles.recent_emojis text[]` + a SECURITY DEFINER RPC `push_recent_emoji`. A single `react(emoji)` defined inline in `MessageItem` toggles the reaction and, on add, records the recent via RPC + `refreshProfile()`. `MessageActions` is rewritten into the new toolbar (recents, emoji-picker-react popover, reply, ⋯-menu with pin/edit/delete). `ReactionBar` drops its old fixed 6-emoji quick row and calls the shared `react`.

**Tech Stack:** Next.js 16 (App Router, client components), TypeScript, Tailwind v4 tokens, Supabase (Postgres `text[]` column + SQL RPC, `reactions` table), `emoji-picker-react` (already installed), Phosphor icons, Vitest.

## Global Constraints

- **One migration** `supabase/migrations/0015_recent_emojis.sql`: adds the column AND the RPC exactly as written in Task 2. **No other schema change.** The RPC is `security definer` and writes only `where id = auth.uid()`.
- **No new dependency** (`emoji-picker-react` is already in `package.json`), no env change.
- Recents list is **most-recent-first**, **deduped**, **capped at 12 stored**, **3 shown**. Seed shown recents with `👍 ❤️ 😂` when the user has fewer than 3.
- **Only adding** a reaction records a recent; **removing** one never touches recents.
- Remove the old inline 6-emoji quick-react row from `ReactionBar`; **keep** the rounded-pill styling already committed (`border-accent bg-accent/15` mine-state, accent count).
- The toolbar must stay visible while its picker or ⋯-menu is open (not pure `group-hover`).
- Reuse existing token/class idioms: `bg-surface`, `bg-surface-2`, `border-line`, `text-ink`, `text-muted`, `text-danger`, `text-accent`, rounded-xl popovers with `shadow-lg`.

---

### Task 1: `recentEmojis.ts` pure helpers (TDD)

**Files:**
- Create: `src/lib/recentEmojis.ts`
- Test: `tests/recentEmojis.test.ts`

**Interfaces:**
- Produces:
  - `export function pushRecent(list: string[], emoji: string, max?: number): string[]` (default `max=12`)
  - `export function toolbarRecents(recent: string[]): string[]` (always length 3)

- [ ] **Step 1: Write the failing tests**

Create `tests/recentEmojis.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pushRecent, toolbarRecents } from "@/lib/recentEmojis";

describe("pushRecent", () => {
  it("unshifts a new emoji to the front", () => {
    expect(pushRecent(["😀", "🎉"], "❤️")).toEqual(["❤️", "😀", "🎉"]);
  });
  it("moves an existing emoji to the front without duplicating", () => {
    expect(pushRecent(["😀", "🎉", "❤️"], "🎉")).toEqual(["🎉", "😀", "❤️"]);
  });
  it("caps the list at max, dropping the oldest", () => {
    expect(pushRecent(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });
  it("defaults the cap to 12", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `e${i}`);
    const out = pushRecent(twelve, "new");
    expect(out).toHaveLength(12);
    expect(out[0]).toBe("new");
    expect(out).not.toContain("e11");
  });
});

describe("toolbarRecents", () => {
  it("returns the user's recents first, always length 3", () => {
    expect(toolbarRecents(["🔥", "🚀"])).toEqual(["🔥", "🚀", "👍"]);
  });
  it("pads entirely from the seed when empty", () => {
    expect(toolbarRecents([])).toEqual(["👍", "❤️", "😂"]);
  });
  it("does not duplicate a seed emoji already in recents", () => {
    expect(toolbarRecents(["❤️"])).toEqual(["❤️", "👍", "😂"]);
  });
  it("truncates to 3 when recents already has more", () => {
    expect(toolbarRecents(["🔥", "🚀", "✨", "🎯"])).toEqual(["🔥", "🚀", "✨"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/recentEmojis.test.ts`
Expected: FAIL — module not found / functions undefined.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/recentEmojis.ts`:

```ts
/** Most-recent-first list after using `emoji`: dedupe, unshift, cap at `max` (default 12). */
export function pushRecent(list: string[], emoji: string, max = 12): string[] {
  return [emoji, ...list.filter((x) => x !== emoji)].slice(0, max);
}

const SEED = ["👍", "❤️", "😂"];

/** The three emojis to show in the toolbar: user's recents, padded from SEED, no dupes, length 3. */
export function toolbarRecents(recent: string[]): string[] {
  const out = [...recent];
  for (const s of SEED) {
    if (out.length >= 3) break;
    if (!out.includes(s)) out.push(s);
  }
  return out.slice(0, 3);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/recentEmojis.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/recentEmojis.ts tests/recentEmojis.test.ts
git commit -m "feat: recentEmojis helpers (pushRecent, toolbarRecents) TDD"
```

---

### Task 2: Migration `0015_recent_emojis.sql` + `Profile` type

**Files:**
- Create: `supabase/migrations/0015_recent_emojis.sql`
- Modify: `src/types/db.ts` (add `recent_emojis` to `Profile`)

**Interfaces:**
- Produces: DB column `profiles.recent_emojis text[]` and RPC `push_recent_emoji(e text)`; TS field `Profile.recent_emojis: string[]`.

This task only WRITES the migration file and updates the type. The controller diffs the SQL verbatim against the spec, then the user runs it in Supabase before manual verification (Task 5). Do NOT attempt to apply the migration yourself.

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/0015_recent_emojis.sql`:

```sql
-- Per-user most-recently-used reaction emojis (most-recent first), for the message toolbar.
alter table public.profiles
  add column if not exists recent_emojis text[] not null default '{}';

-- Atomically record an emoji as most-recent for the calling user: dedupe, unshift, cap at 12.
create or replace function public.push_recent_emoji(e text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set recent_emojis =
       (array[e] || array_remove(recent_emojis, e))[1:12]
   where id = auth.uid();
$$;

grant execute on function public.push_recent_emoji(text) to authenticated;
```

- [ ] **Step 2: Add the field to the `Profile` type**

In `src/types/db.ts`, add to the `Profile` type (after `status`):

```ts
  recent_emojis: string[];
```

- [ ] **Step 3: Verify the type compiles**

Run: `npx tsc --noEmit`
Expected: no NEW type errors from `db.ts`. (`AuthProvider` already does `profiles.select("*")`, so the field flows through with no query change.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0015_recent_emojis.sql src/types/db.ts
git commit -m "feat: recent_emojis column + push_recent_emoji RPC (migration) + Profile type"
```

---

### Task 3: Shared `react()` in `MessageItem` + rewire `ReactionBar`

**Files:**
- Modify: `src/components/messages/MessageItem.tsx`
- Modify: `src/components/messages/ReactionBar.tsx`

**Interfaces:**
- Consumes: `useAuth()` → adds `refreshProfile` to the existing `{ user, profile }` destructure; `pills: ReactionPill[]` (already a prop); `supabase` (already created).
- Produces: `react(emoji: string): Promise<void>` passed as `onReact` to `ReactionBar` (and, in Task 4, to `MessageActions`). `ReactionBar` new signature: `{ pills, onReact }`.

- [ ] **Step 1: Add `react` to `MessageItem` and update the `useAuth` destructure**

In `src/components/messages/MessageItem.tsx`:

Change the auth destructure (currently `const { user, profile } = useAuth();`) to include `refreshProfile`:

```tsx
  const { user, profile, refreshProfile } = useAuth();
```

Add this function alongside the other handlers (e.g. after `togglePin`):

```tsx
  async function react(emoji: string) {
    if (!user) return;
    const mine = pills.find((p) => p.emoji === emoji)?.mine ?? false;
    if (mine) {
      await supabase
        .from("reactions")
        .delete()
        .eq("message_id", msg.id)
        .eq("user_id", user.id)
        .eq("emoji", emoji);
    } else {
      await supabase.from("reactions").insert({ message_id: msg.id, user_id: user.id, emoji });
      await supabase.rpc("push_recent_emoji", { e: emoji });
      await refreshProfile();
    }
  }
```

- [ ] **Step 2: Pass `onReact` to `ReactionBar`**

Change the `ReactionBar` usage (currently `<ReactionBar message={msg} pills={pills} />`) to:

```tsx
          {!editing && <ReactionBar pills={pills} onReact={react} />}
```

- [ ] **Step 3: Rewrite `ReactionBar` to use `onReact` and drop the quick row**

Replace the ENTIRE contents of `src/components/messages/ReactionBar.tsx` with:

```tsx
"use client";

import type { ReactionPill } from "@/lib/reactions";

export function ReactionBar({
  pills,
  onReact,
}: {
  pills: ReactionPill[];
  onReact: (emoji: string) => void;
}) {
  if (pills.length === 0) return null;
  return (
    <div className="flex items-center flex-wrap gap-1 mt-1">
      {pills.map((p) => (
        <button
          key={p.emoji}
          onClick={() => onReact(p.emoji)}
          title={p.mine ? "Remove your reaction" : `React ${p.emoji}`}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 leading-none transition ${
            p.mine
              ? "border-accent bg-accent/15 hover:bg-accent/25"
              : "border-line bg-surface-2 hover:border-white/20 hover:bg-surface"
          }`}
        >
          <span className="text-sm">{p.emoji}</span>
          <span className={`text-xs font-semibold tabular-nums ${p.mine ? "text-accent" : "text-muted"}`}>
            {p.count}
          </span>
        </button>
      ))}
    </div>
  );
}
```

This removes the `EMOJI` constant, the `hidden group-hover:flex` quick row, and `ReactionBar`'s own `supabase`/`useAuth`/`toggle` (reactions now flow through `onReact`). It keeps the rounded-pill styling from the branch baseline.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. (The old `message` prop is gone from `ReactionBar`; confirm `MessageItem` no longer passes it — Step 2 already updated the call.)

- [ ] **Step 5: Commit**

```bash
git add src/components/messages/MessageItem.tsx src/components/messages/ReactionBar.tsx
git commit -m "feat: shared react() path; ReactionBar uses onReact, drops fixed quick row"
```

---

### Task 4: Rewrite `MessageActions` into the new toolbar + wire it

**Files:**
- Modify: `src/components/messages/MessageActions.tsx` (full rewrite)
- Modify: `src/components/messages/MessageItem.tsx` (pass `recents` + `onReact`)

**Interfaces:**
- Consumes: `react` (from Task 3) as `onReact`; `toolbarRecents` from `@/lib/recentEmojis`; `profile.recent_emojis` (from Task 2).
- Produces: `MessageActions` with new props `recents: string[]` and `onReact: (emoji: string) => void` alongside the existing `onReply, onPin, pinned, canEdit, onEdit, onDelete`.

- [ ] **Step 1: Rewrite `MessageActions`**

Replace the ENTIRE contents of `src/components/messages/MessageActions.tsx` with:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import EmojiPicker, { Theme } from "emoji-picker-react";
import {
  ArrowBendUpLeft,
  PushPin,
  PencilSimple,
  Trash,
  Smiley,
  DotsThree,
} from "@phosphor-icons/react";

export function MessageActions({
  recents,
  onReact,
  onReply,
  onPin,
  pinned,
  canEdit,
  onEdit,
  onDelete,
}: {
  recents: string[];
  onReact: (emoji: string) => void;
  onReply: () => void;
  onPin: () => void;
  pinned: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = pickerOpen || menuOpen;

  useEffect(() => {
    if (!pickerOpen) return;
    function onDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPickerOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pickerOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <div
      className={`absolute right-2 top-0 ${
        open ? "flex" : "hidden group-hover:flex"
      } items-center gap-1 bg-surface rounded-xl border border-line px-1 py-0.5 text-sm`}
    >
      {recents.map((e) => (
        <button
          key={e}
          onClick={() => onReact(e)}
          title={`React ${e}`}
          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-2 text-base leading-none"
        >
          {e}
        </button>
      ))}

      <span className="mx-0.5 w-px self-stretch bg-line" />

      <div className="relative" ref={pickerRef}>
        <button
          onClick={() => { setPickerOpen((o) => !o); setMenuOpen(false); }}
          title="Pick an emoji"
          aria-label="Pick an emoji"
          className="text-muted hover:text-ink w-7 h-7 flex items-center justify-center"
        >
          <Smiley size={18} />
        </button>
        {pickerOpen && (
          <div className="absolute top-full right-0 mt-2 z-30">
            <EmojiPicker
              theme={Theme.DARK}
              onEmojiClick={(d) => { onReact(d.emoji); setPickerOpen(false); }}
              lazyLoadEmojis
              skinTonesDisabled
            />
          </div>
        )}
      </div>

      <button
        onClick={onReply}
        title="Reply"
        aria-label="Reply"
        className="text-muted hover:text-ink w-7 h-7 flex items-center justify-center"
      >
        <ArrowBendUpLeft size={16} weight="bold" />
      </button>

      <div className="relative" ref={menuRef}>
        <button
          onClick={() => { setMenuOpen((o) => !o); setPickerOpen(false); }}
          title="More"
          aria-label="More"
          className="text-muted hover:text-ink w-7 h-7 flex items-center justify-center"
        >
          <DotsThree size={18} weight="bold" />
        </button>
        {menuOpen && (
          <div className="absolute top-full right-0 mt-2 z-20 w-40 rounded-xl border border-line bg-surface shadow-lg py-1">
            <button
              onClick={() => { setMenuOpen(false); onPin(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-ink hover:bg-surface-2 text-left"
            >
              <PushPin size={15} /> {pinned ? "Unpin" : "Pin"}
            </button>
            {canEdit && (
              <>
                <button
                  onClick={() => { setMenuOpen(false); onEdit(); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-ink hover:bg-surface-2 text-left"
                >
                  <PencilSimple size={15} /> Edit
                </button>
                <button
                  onClick={() => { setMenuOpen(false); onDelete(); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-danger hover:bg-surface-2 text-left"
                >
                  <Trash size={15} /> Delete
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire `recents` + `onReact` from `MessageItem`**

In `src/components/messages/MessageItem.tsx`, add the import:

```tsx
import { toolbarRecents } from "@/lib/recentEmojis";
```

Update the `<MessageActions ... />` usage to pass the two new props (keep all existing ones):

```tsx
        <MessageActions
          recents={toolbarRecents(profile?.recent_emojis ?? [])}
          onReact={react}
          onReply={() => onReply?.(msg, authorName)}
          onPin={togglePin}
          pinned={msg.pinned}
          canEdit={isMine}
          onEdit={() => {
            setDraft(msg.content);
            setEditing(true);
          }}
          onDelete={remove}
        />
```

- [ ] **Step 3: Build + full test suite**

Run: `npm run build && npx vitest run`
Expected: build succeeds; all tests pass (existing + Task 1's recentEmojis tests). If the build cannot resolve `DotsThree` from `@phosphor-icons/react`, confirm the import name spelling (it is exported by the package).

- [ ] **Step 4: Commit**

```bash
git add src/components/messages/MessageActions.tsx src/components/messages/MessageItem.tsx
git commit -m "feat: message toolbar (recents, emoji picker, reply, more-menu)"
```

---

### Task 5: Run migration + manual verification

**Files:** none (operational + verification).

- [ ] **Step 1: Apply the migration (controller + user)**

The controller presents `supabase/migrations/0015_recent_emojis.sql` to the user to run in the Supabase SQL editor (this project's live-DB convention), then reconciles the CLI history (`npx supabase migration repair --status applied 0015`). Do not proceed to Step 2 until the user confirms the SQL ran.

- [ ] **Step 2: Manual verification on localhost**

With the dev server running and logged in:
1. Hover a message → toolbar shows **3 recent emojis │ 😀 picker · ↩ reply · ⋯**.
2. Click a recent → the reaction toggles on the message (a pill appears/updates); click again → it removes.
3. After reacting with an emoji, that emoji becomes **recents slot 1**; reload / open a second browser session as the same user → the recents order persists (synced). A repeat emoji does not duplicate.
4. Open the **😀 picker** → choose any emoji → it reacts and becomes a recent. Moving the mouse onto the picker does NOT close the toolbar; outside-click and **Escape** close it.
5. **⋯** opens a menu with **Pin/Unpin**, plus **Edit** + **Delete** on your own messages; each works and closes the menu; the toolbar stays open while the menu is open.
6. The old row of 6 fixed quick emojis under messages is gone; pills still show counts with the mine-accent styling.

- [ ] **Step 3: Record results**

Note pass/fail per item; fix and re-verify any failure before considering the slice complete.

---

## Self-Review

**Spec coverage:**
- Toolbar layout recents │ picker · reply · ⋯more → Task 4. ✓
- ⋯ menu = Pin/Unpin + Edit/Delete(mine) → Task 4. ✓
- Synced recents (column + RPC, cap 12/show 3, dedupe, most-recent-first) → Task 2 (SQL) + Task 1 (helpers). ✓
- Only adds record recents; removes don't → Task 3 `react` (RPC only in the insert branch). ✓
- Shared `react()` path; pills use it → Task 3. ✓
- Remove old 6-emoji quick row; keep pill styling → Task 3 (baseline styling already committed). ✓
- Toolbar stays open while picker/menu open → Task 4 (`open` flag). ✓
- Picker reuses emoji-picker-react → Task 4. ✓
- `Profile.recent_emojis` type + flows via `select("*")` → Task 2. ✓
- Unit tests for helpers → Task 1. ✓
- Migration diff + run before manual → Task 5. ✓

**Placeholder scan:** No TBD/TODO; every component/SQL step has full content; test code is concrete.

**Type consistency:** `react(emoji: string): Promise<void>` defined in Task 3, consumed as `onReact` by `ReactionBar` (Task 3) and `MessageActions` (Task 4) with the same signature. `toolbarRecents`/`pushRecent` names match Task 1 exactly. `MessageActions` prop set (recents, onReact, onReply, onPin, pinned, canEdit, onEdit, onDelete) matches `MessageItem`'s usage in Task 4 Step 2. `Profile.recent_emojis: string[]` (Task 2) matches `profile?.recent_emojis ?? []` (Task 4). RPC name/arg `push_recent_emoji({ e })` matches between Task 2 SQL and Task 3 call.
