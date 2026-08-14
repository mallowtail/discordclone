# Message Forwarding (Discord-style) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Forward action: a searchable multi-select dialog picks channels (across servers) + DMs; the message is forwarded as a frozen `forward_snapshot` that renders as a Discord-style "Forwarded" quoted block in each destination, with an optional comment.

**Architecture:** A `jsonb forward_snapshot` column on `messages` holds a frozen copy of the original. A pure `buildForwardSnapshot` helper (unit-tested) builds it. `ForwardDialog` loads destinations (servers→channels via `useServers`, DMs via `conversation_members`), lets the user multi-select + comment, and does one batched `messages.insert` (a row per destination). `ForwardedBlock` renders the snapshot, sanitizing attachment URLs with a shared `isHttpUrl` extracted from `MessageContent`. A Forward button wires into the toolbar.

**Tech Stack:** Next.js 16 (App Router, client components), TypeScript, Tailwind v4 tokens, Supabase (`messages` insert under existing RLS, `channels`/`conversation_members` reads), Vitest.

## Global Constraints

- **One migration** `supabase/migrations/0016_forward_snapshot.sql`: `alter table public.messages add column if not exists forward_snapshot jsonb;` — nothing else. No new RLS (existing `messages` INSERT policy governs forwarded rows).
- **No new dependency, no env change.**
- Snapshot is a **frozen copy** — no live reference/jump-to-original, no nesting (snapshot the outer message's own fields).
- **Source label:** `#channel-name` for channel messages, `a direct message` for DMs.
- Attachment URLs in a snapshot MUST be sanitized with the same http(s)-only guard used by `MessageContent` before rendering (extract it to `src/lib/url.ts` and share).
- Forward button sits **between Reply and the ⋯ menu** in `MessageActions`; Reply and the ⋯ menu are otherwise unchanged.
- Reuse existing idioms: dialog overlay `fixed inset-0 bg-black/60 flex items-center justify-center z-50` with inner `bg-surface rounded-2xl border border-line`; inputs `bg-surface-2 text-ink rounded-xl`; primary button `bg-accent hover:bg-accent-strong text-white`.

---

### Task 1: `ForwardSnapshot` type + `buildForwardSnapshot` helper (TDD)

**Files:**
- Modify: `src/types/db.ts`
- Create: `src/lib/forward.ts`
- Test: `tests/forward.test.ts`

**Interfaces:**
- Produces: `ForwardSnapshot` type; `Message.forward_snapshot: ForwardSnapshot | null`; `buildForwardSnapshot(original: Message, sourceLabel: string): ForwardSnapshot`.

- [ ] **Step 1: Add the type + field to `src/types/db.ts`**

Add this type (near `Message`), and add the field to `Message`:

```ts
export type ForwardSnapshot = {
  author_id: string;
  content: string;
  image_url: string | null;
  file_url: string | null;
  file_name: string | null;
  source: string; // e.g. "#general" or "a direct message"
};
```
In the `Message` type, add (after `pinned_at`):
```ts
  forward_snapshot: ForwardSnapshot | null;
```

- [ ] **Step 2: Write the failing test**

Create `tests/forward.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildForwardSnapshot } from "@/lib/forward";
import type { Message } from "@/types/db";

function msg(over: Partial<Message> = {}): Message {
  return {
    id: "m1", author_id: "u1", channel_id: "c1", conversation_id: null,
    content: "hello", image_url: null, file_url: null, file_name: null,
    created_at: "t", updated_at: null, reply_to_id: null, mention_author: false,
    pinned: false, pinned_at: null, forward_snapshot: null, ...over,
  };
}

describe("buildForwardSnapshot", () => {
  it("freezes author, content, attachments, and the given source label", () => {
    const s = buildForwardSnapshot(
      msg({ author_id: "u9", content: "hi", image_url: "http://x/y.png", file_url: "http://x/f.pdf", file_name: "f.pdf" }),
      "#general",
    );
    expect(s).toEqual({
      author_id: "u9", content: "hi", image_url: "http://x/y.png",
      file_url: "http://x/f.pdf", file_name: "f.pdf", source: "#general",
    });
  });
  it("coerces null/empty content to an empty string", () => {
    const s = buildForwardSnapshot(msg({ content: "" as unknown as string }), "a direct message");
    expect(s.content).toBe("");
    expect(s.source).toBe("a direct message");
  });
  it("snapshots the outer message's own fields when forwarding a forward (no nesting)", () => {
    const inner: ForwardSnapshotShape = { author_id: "u1", content: "orig", image_url: null, file_url: null, file_name: null, source: "#old" };
    const s = buildForwardSnapshot(msg({ author_id: "u2", content: "outer", forward_snapshot: inner }), "#new");
    expect(s.author_id).toBe("u2");
    expect(s.content).toBe("outer");
    expect(s.source).toBe("#new");
  });
});

type ForwardSnapshotShape = Message["forward_snapshot"];
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/forward.test.ts`
Expected: FAIL — `@/lib/forward` not found.

- [ ] **Step 4: Write the implementation**

Create `src/lib/forward.ts`:

```ts
import type { Message, ForwardSnapshot } from "@/types/db";

/** Freeze the display-relevant fields of `original` into a forward snapshot.
 *  Snapshots the outer message's own fields — forwarding a forward does not nest. */
export function buildForwardSnapshot(original: Message, sourceLabel: string): ForwardSnapshot {
  return {
    author_id: original.author_id,
    content: original.content ?? "",
    image_url: original.image_url,
    file_url: original.file_url,
    file_name: original.file_name,
    source: sourceLabel,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/forward.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types/db.ts src/lib/forward.ts tests/forward.test.ts
git commit -m "feat: ForwardSnapshot type + buildForwardSnapshot helper (TDD)"
```

---

### Task 2: Migration `0016_forward_snapshot.sql`

**Files:**
- Create: `supabase/migrations/0016_forward_snapshot.sql`

**Interfaces:**
- Produces: DB column `messages.forward_snapshot jsonb` (nullable).

This task only WRITES the file. The controller diffs it verbatim; the migration is applied before manual verification (Task 6). Do NOT apply it yourself.

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/0016_forward_snapshot.sql`:

```sql
-- A forwarded message carries a frozen snapshot of the original (see ForwardSnapshot in the app).
alter table public.messages
  add column if not exists forward_snapshot jsonb;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0016_forward_snapshot.sql
git commit -m "feat: forward_snapshot column on messages (migration)"
```

---

### Task 3: Shared `isHttpUrl` + `ForwardedBlock` render component

**Files:**
- Create: `src/lib/url.ts`
- Modify: `src/components/messages/MessageContent.tsx` (use the shared helper)
- Create: `src/components/messages/ForwardedBlock.tsx`

**Interfaces:**
- Consumes: `ForwardSnapshot` (Task 1); `Avatar`; `createClient`; `Profile`.
- Produces: `isHttpUrl(url: string): boolean` from `@/lib/url`; `ForwardedBlock` component.

- [ ] **Step 1: Extract `isHttpUrl` to `src/lib/url.ts`**

Create `src/lib/url.ts`:

```ts
/** True only for http(s) URLs — gate user-supplied URL columns before rendering. */
export function isHttpUrl(url: string): boolean {
  try {
    const proto = new URL(url).protocol;
    return proto === "http:" || proto === "https:";
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Point `MessageContent` at the shared helper**

In `src/components/messages/MessageContent.tsx`, remove its local `isHttpUrl` definition and instead
`import { isHttpUrl } from "@/lib/url";`. Leave all other logic (the `safeImage`/`safeFile` usage) unchanged.

- [ ] **Step 3: Create `ForwardedBlock`**

Create `src/components/messages/ForwardedBlock.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/user/Avatar";
import { isHttpUrl } from "@/lib/url";
import type { ForwardSnapshot, Profile } from "@/types/db";
import { ArrowBendUpRight } from "@phosphor-icons/react";

export function ForwardedBlock({ snapshot }: { snapshot: ForwardSnapshot }) {
  const supabase = createClient();
  const [author, setAuthor] = useState<Profile | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.from("profiles").select("*").eq("id", snapshot.author_id).single();
      if (active) setAuthor((data as Profile) ?? null);
    })();
    return () => { active = false; };
  }, [supabase, snapshot.author_id]);

  const img = snapshot.image_url && isHttpUrl(snapshot.image_url) ? snapshot.image_url : null;
  const file = snapshot.file_url && isHttpUrl(snapshot.file_url) ? snapshot.file_url : null;

  return (
    <div className="mt-1">
      <div className="flex items-center gap-1 text-[11px] text-muted mb-1">
        <ArrowBendUpRight size={13} weight="bold" /> Forwarded
      </div>
      <div className="border-l-2 border-line pl-3">
        <div className="flex items-center gap-2 mb-1">
          <Avatar url={author?.avatar_url ?? null} name={author?.display_name} size="sm" />
          <span className="text-ink text-sm font-medium">{author?.display_name ?? "Someone"}</span>
          <span className="text-muted text-xs">from {snapshot.source}</span>
        </div>
        {snapshot.content && <div className="text-ink text-sm break-words leading-relaxed">{snapshot.content}</div>}
        {img && <img src={img} alt="" className="mt-1 max-h-60 rounded-lg" />}
        {file && (
          <a href={file} target="_blank" rel="noreferrer" className="mt-1 inline-block text-accent text-sm hover:underline">
            {snapshot.file_name ?? "Attachment"}
          </a>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from the three files. (Ignore any pre-existing unrelated error in `tests/grouping.test.ts`.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/url.ts src/components/messages/MessageContent.tsx src/components/messages/ForwardedBlock.tsx
git commit -m "feat: shared isHttpUrl + ForwardedBlock render component"
```

---

### Task 4: `ForwardDialog` (searchable multi-select + send)

**Files:**
- Create: `src/components/messages/ForwardDialog.tsx`

**Interfaces:**
- Consumes: `useServers()` → `{ servers }`; `useAuth()` → `{ user }`; `createClient()`; `buildForwardSnapshot` (Task 1); `Channel`, `Message` types.
- Produces: `ForwardDialog({ message, onClose }: { message: Message; onClose: () => void })`.

- [ ] **Step 1: Create the dialog**

Create `src/components/messages/ForwardDialog.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { useServers } from "@/hooks/useServers";
import { buildForwardSnapshot } from "@/lib/forward";
import type { Channel, Message } from "@/types/db";

type Dest = { key: string; kind: "channel" | "dm"; id: string; label: string; group: string };

export function ForwardDialog({ message, onClose }: { message: Message; onClose: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const { servers } = useServers();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [dms, setDms] = useState<{ id: string; label: string }[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const serverIdsKey = servers.map((s) => s.id).join(",");
  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      const serverIds = serverIdsKey ? serverIdsKey.split(",") : [];
      if (serverIds.length) {
        const { data } = await supabase.from("channels").select("*").in("server_id", serverIds).order("position");
        if (active) setChannels((data as Channel[]) ?? []);
      } else if (active) setChannels([]);
      const { data: memberships } = await supabase
        .from("conversation_members").select("conversation_id").eq("user_id", user.id);
      const convIds = (memberships ?? []).map((m) => m.conversation_id);
      if (convIds.length) {
        const { data: others } = await supabase
          .from("conversation_members").select("conversation_id, profiles(*)")
          .in("conversation_id", convIds).neq("user_id", user.id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (active) setDms(((others ?? []) as any[]).map((o) => ({ id: o.conversation_id, label: o.profiles?.display_name ?? "Direct message" })));
      } else if (active) setDms([]);
    })();
    return () => { active = false; };
  }, [supabase, user, serverIdsKey]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const serverName = (id: string) => servers.find((s) => s.id === id)?.name ?? "Server";
  const dests: Dest[] = [
    ...channels.map((c) => ({ key: `channel:${c.id}`, kind: "channel" as const, id: c.id, label: `#${c.name}`, group: serverName(c.server_id) })),
    ...dms.map((d) => ({ key: `dm:${d.id}`, kind: "dm" as const, id: d.id, label: d.label, group: "Direct Messages" })),
  ];
  const q = search.trim().toLowerCase();
  const filtered = q ? dests.filter((d) => d.label.toLowerCase().includes(q) || d.group.toLowerCase().includes(q)) : dests;
  const groups = filtered.reduce<Record<string, Dest[]>>((acc, d) => { (acc[d.group] ??= []).push(d); return acc; }, {});

  const sourceLabel = message.channel_id
    ? (() => { const c = channels.find((ch) => ch.id === message.channel_id); return c ? `#${c.name}` : "a channel"; })()
    : "a direct message";

  function toggle(key: string) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }

  async function forward() {
    if (selected.size === 0 || !user) return;
    setBusy(true); setError(null);
    const snapshot = buildForwardSnapshot(message, sourceLabel);
    const rows = [...selected].map((key) => {
      const [kind, id] = key.split(":");
      return {
        author_id: user.id,
        content: comment.trim(),
        forward_snapshot: snapshot,
        channel_id: kind === "channel" ? id : null,
        conversation_id: kind === "dm" ? id : null,
      };
    });
    const { error: err } = await supabase.from("messages").insert(rows);
    setBusy(false);
    if (err) return setError("Couldn't forward — try again");
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface rounded-2xl border border-line w-80 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 pb-2">
          <h2 className="text-[15px] font-semibold text-ink tracking-tight mb-3">Forward message</h2>
          <input
            autoFocus value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search channels and DMs"
            className="w-full p-2 rounded-xl bg-surface-2 text-ink text-sm"
          />
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-1">
          {Object.keys(groups).length === 0 && <p className="text-muted text-sm py-2">No destinations found.</p>}
          {Object.entries(groups).map(([group, rows]) => (
            <div key={group} className="mb-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted mt-2 mb-1">{group}</div>
              {rows.map((d) => (
                <label key={d.key} className="flex items-center gap-2 px-1 py-1 rounded-lg hover:bg-surface-2 cursor-pointer">
                  <input type="checkbox" checked={selected.has(d.key)} onChange={() => toggle(d.key)} />
                  <span className="text-ink text-sm truncate">{d.label}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
        <div className="p-4 pt-2 border-t border-line">
          {error && <p className="text-danger text-sm mb-2">{error}</p>}
          <input
            value={comment} onChange={(e) => setComment(e.target.value)}
            placeholder="Add a comment — optional"
            className="w-full p-2 rounded-xl bg-surface-2 text-ink text-sm mb-2"
          />
          <button
            onClick={forward} disabled={busy || selected.size === 0}
            className="w-full bg-accent hover:bg-accent-strong text-white font-medium rounded-xl p-2 disabled:opacity-50"
          >
            {busy ? "Forwarding…" : selected.size ? `Forward to ${selected.size}` : "Forward"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from `ForwardDialog.tsx`. (Confirm `useServers` is imported from `@/hooks/useServers` and returns `{ servers }`.)

- [ ] **Step 3: Commit**

```bash
git add src/components/messages/ForwardDialog.tsx
git commit -m "feat: ForwardDialog — searchable multi-select destinations + batched send"
```

---

### Task 5: Wire the Forward button + render the block

**Files:**
- Modify: `src/components/messages/MessageActions.tsx` (add Forward button + prop)
- Modify: `src/components/messages/MessageItem.tsx` (open dialog, render block)

**Interfaces:**
- Consumes: `ForwardDialog` (Task 4), `ForwardedBlock` (Task 3); `ArrowBendUpRight` icon.
- Produces: `MessageActions` gains `onForward: () => void`.

- [ ] **Step 1: Add the Forward button to `MessageActions`**

In `src/components/messages/MessageActions.tsx`:
- Add `ArrowBendUpRight` to the `@phosphor-icons/react` import.
- Add `onForward: () => void;` to the props type, and `onForward` to the destructured params.
- Insert a Forward button **between the Reply button and the ⋯ more-menu `<div>`**:

```tsx
      <button
        onClick={onForward}
        title="Forward"
        aria-label="Forward"
        className="text-muted hover:text-ink w-7 h-7 flex items-center justify-center"
      >
        <ArrowBendUpRight size={16} weight="bold" />
      </button>
```

- [ ] **Step 2: Wire `MessageItem`**

In `src/components/messages/MessageItem.tsx`:
- Add imports:
```tsx
import { ForwardDialog } from "@/components/messages/ForwardDialog";
import { ForwardedBlock } from "@/components/messages/ForwardedBlock";
```
- Add state near the other `useState`s:
```tsx
  const [forwarding, setForwarding] = useState(false);
```
- Render `ForwardedBlock` right after `<MessageContent msg={msg} />` (inside the same non-editing branch, before `ReactionBar`):
```tsx
          {!editing && msg.forward_snapshot && <ForwardedBlock snapshot={msg.forward_snapshot} />}
```
- Pass `onForward` to `MessageActions` (keep all existing props):
```tsx
          onForward={() => setForwarding(true)}
```
- Render the dialog (e.g. just before the closing `</div>` of the component, alongside other conditional overlays):
```tsx
      {forwarding && <ForwardDialog message={msg} onClose={() => setForwarding(false)} />}
```

- [ ] **Step 3: Build + full test suite**

Run: `npm run build && npx vitest run`
Expected: build succeeds; all tests pass (existing + `forward.test.ts`). (A pre-existing tsc-only error in `tests/grouping.test.ts` does not fail `npm run build` or `npx vitest run`; if both pass, that's success.)

- [ ] **Step 4: Commit**

```bash
git add src/components/messages/MessageActions.tsx src/components/messages/MessageItem.tsx
git commit -m "feat: Forward button in toolbar; render ForwardedBlock; open ForwardDialog"
```

---

### Task 6: Apply migration + manual verification

**Files:** none (operational + verification).

- [ ] **Step 1: Apply the migration**

The controller diffs `0016_forward_snapshot.sql` verbatim against this plan, then applies it to the
linked Supabase project (`npx supabase db push`, user-authorized) and confirms `migration list` shows
0016 remote. Do not proceed to Step 2 until applied.

- [ ] **Step 2: Manual verification on localhost**

With the dev server running and logged in:
1. Hover a message → toolbar shows **recents │ picker · reply · ↪ forward · ⋯**.
2. Click **Forward** → dialog lists your channels (grouped by server) + DMs; the search box filters both.
3. Select **two channels + one DM**, add a comment, Forward → each destination shows your comment as
   normal text plus a **"Forwarded"** block (original author avatar/name, `from #source`, the text).
4. Forward an **image** message with **no** comment → the block shows the image; no comment line.
5. The **original** message is unchanged. A non-forwarded message shows no block.
6. The Forward button is disabled with nothing selected; the button label shows the selected count.

- [ ] **Step 3: Record results**

Note pass/fail per item; fix and re-verify any failure before considering the slice complete.

---

## Self-Review

**Spec coverage:**
- `forward_snapshot jsonb` migration → Task 2. ✓
- `ForwardSnapshot` type + `Message.forward_snapshot` → Task 1. ✓
- `buildForwardSnapshot` (frozen, no nesting) + unit tests → Task 1. ✓
- Searchable multi-select over channels(grouped)+DMs, comment, batched insert → Task 4. ✓
- Source label `#channel` / `a direct message` → Task 4 (`sourceLabel`). ✓
- ForwardedBlock render with shared `isHttpUrl` sanitization → Task 3. ✓
- Forward button between reply and ⋯ + open dialog + render block → Task 5. ✓
- Existing RLS governs inserts (no new policy) → Task 2 note. ✓
- Migration applied before manual → Task 6. ✓

**Placeholder scan:** No TBD/TODO; every component/SQL/test step has full content.

**Type consistency:** `ForwardSnapshot` fields identical across Task 1 (type), Task 3 (`ForwardedBlock` reads `author_id`/`content`/`image_url`/`file_url`/`file_name`/`source`), and Task 4 (built via `buildForwardSnapshot`). `buildForwardSnapshot(original, sourceLabel)` signature matches Task 1 test and Task 4 call. `ForwardDialog({ message, onClose })` matches Task 5's usage. `MessageActions` gains `onForward: () => void` (Task 5 Step 1) matching `MessageItem`'s `onForward={() => setForwarding(true)}` (Task 5 Step 2). Destination key format `"${kind}:${id}"` is split back with `key.split(":")` in `forward()` — ids are UUIDs (no colon), so the 2-part split is safe.
