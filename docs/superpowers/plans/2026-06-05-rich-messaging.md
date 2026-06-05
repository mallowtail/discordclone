# Rich Messaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add edit/delete, Discord-style markdown, emoji reactions, and inline image upload to the existing chat app.

**Architecture:** Extends the Supabase data model (new columns on `messages`, a new `reactions` table, a Storage bucket) with RLS for the new operations, renders messages through a safe markdown component, and broadcasts edits/deletes/reactions over the existing Supabase Realtime channels. Pure logic (image validation, reaction aggregation) lives in tested helper modules; UI is built from small focused components.

**Tech Stack:** Next.js 16 + TypeScript, Supabase (Postgres + RLS + Realtime + Storage), `react-markdown` + `remark-gfm`, Vitest.

---

## Prerequisites (manual, before coding)

- [ ] **P1: Node on PATH.** In the project terminal: `node --version` (expect v20+). If missing: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"`.
- [ ] **P2:** The live Supabase project must be **active** (not paused). Open the dashboard; if paused, click Resume. (Free-tier projects auto-pause after ~1 week idle.)

## File Structure

```
website/
  supabase/migrations/
    0002_rich_messaging.sql       # NEW: columns, reactions table, helper, RLS, realtime
  src/
    types/db.ts                   # MODIFY: Message gains updated_at/image_url; add Reaction
    lib/
      upload.ts                   # NEW: pure image validation + Storage upload helper
      reactions.ts                # NEW: pure aggregation of reaction rows -> pills
    hooks/
      useMessages.ts              # MODIFY: handle realtime UPDATE + DELETE
      useReactions.ts             # NEW: realtime reactions for the open channel/DM
    components/
      MessageContent.tsx          # NEW: markdown + inline image + (edited) marker
      MessageActions.tsx          # NEW: hover edit/delete for own messages
      ReactionBar.tsx             # NEW: reaction pills + fixed-set picker
      MessageItem.tsx             # MODIFY: compose the above + inline edit mode
      MessageList.tsx             # MODIFY: thread reaction pills to each item
      MessageInput.tsx            # MODIFY: 📎 attach + upload flow
  tests/
    upload.test.ts                # NEW
    reactions.test.ts             # NEW
```

---

## Task 1: Database migration + types

**Files:**
- Create: `supabase/migrations/0002_rich_messaging.sql`
- Modify: `src/types/db.ts`

- [ ] **Step 1: Write `supabase/migrations/0002_rich_messaging.sql`**

```sql
-- ===== channels.name unique (the live DB predates the canonical 0001 unique) =====
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.channels'::regclass and contype = 'u'
  ) then
    alter table public.channels add constraint channels_name_unique unique (name);
  end if;
end $$;

-- ===== messages: edit + image columns =====
alter table public.messages add column if not exists updated_at timestamptz;
alter table public.messages add column if not exists image_url text;

-- relax the content rule: allow empty content when an image is present
alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages add constraint messages_content_len
  check (char_length(content) <= 2000);
alter table public.messages add constraint messages_nonempty
  check (char_length(content) > 0 or image_url is not null);

-- ===== reactions =====
create table public.reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
create index on public.reactions (message_id);

-- ===== helper: can the current user read a given message? =====
create or replace function public.can_read_message(msg uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.messages m
    where m.id = msg and (
      m.channel_id is not null
      or (m.conversation_id is not null and public.is_conversation_member(m.conversation_id))
    )
  );
$$;

-- ===== RLS: edit/delete own messages =====
create policy "edit own messages"
  on public.messages for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy "delete own messages"
  on public.messages for delete to authenticated
  using (author_id = auth.uid());

-- ===== RLS: reactions =====
alter table public.reactions enable row level security;
create policy "read reactions on readable messages"
  on public.reactions for select to authenticated
  using (public.can_read_message(message_id));
create policy "add own reactions"
  on public.reactions for insert to authenticated
  with check (user_id = auth.uid() and public.can_read_message(message_id));
create policy "remove own reactions"
  on public.reactions for delete to authenticated
  using (user_id = auth.uid());

-- ===== realtime for reactions =====
alter publication supabase_realtime add table public.reactions;
```

- [ ] **Step 2: Run the migration in Supabase**

Dashboard → SQL Editor → New query → paste the whole file → Run. Expected: "Success. No rows returned." Verify under Table Editor that `reactions` exists and `messages` now has `updated_at` and `image_url` columns.

- [ ] **Step 3: Update `src/types/db.ts`** — replace the `Message` type and add `Reaction`:

```ts
export type Message = {
  id: string;
  author_id: string;
  channel_id: string | null;
  conversation_id: string | null;
  content: string;
  image_url: string | null;
  created_at: string;
  updated_at: string | null;
};

export type Reaction = {
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};
```

(Leave `Profile` and `Channel` unchanged.)

- [ ] **Step 4: Verify build**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/mallow/projects/website && npm run build`
Expected: success (the new optional fields don't break existing code).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0002_rich_messaging.sql src/types/db.ts
git commit -m "feat: add rich-messaging schema (edit/image columns, reactions, RLS)"
```

---

## Task 2: Storage bucket for image uploads

**Files:** none (Supabase configuration via SQL)

- [ ] **Step 1: Create the bucket + policies in the SQL editor**

Dashboard → SQL Editor → New query → run:

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', true, 5242880,
        array['image/png','image/jpeg','image/gif','image/webp'])
on conflict (id) do nothing;

create policy "authenticated upload attachments"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments');

create policy "public read attachments"
  on storage.objects for select to public
  using (bucket_id = 'attachments');
```

Expected: "Success." Verify under Storage that an `attachments` bucket exists and is marked public.

- [ ] **Step 2: No commit** (this is remote configuration, no repo files changed). Proceed to Task 3.

---

## Task 3: Image upload helper (TDD)

**Files:**
- Create: `src/lib/upload.ts`
- Test: `tests/upload.test.ts`

- [ ] **Step 1: Write the failing test `tests/upload.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { validateImage } from "@/lib/upload";

const MB = 1024 * 1024;

describe("validateImage", () => {
  it("accepts a small png", () => {
    expect(validateImage({ type: "image/png", size: 2 * MB })).toEqual({ ok: true });
  });
  it("accepts jpeg, gif, webp", () => {
    expect(validateImage({ type: "image/jpeg", size: 1 }).ok).toBe(true);
    expect(validateImage({ type: "image/gif", size: 1 }).ok).toBe(true);
    expect(validateImage({ type: "image/webp", size: 1 }).ok).toBe(true);
  });
  it("rejects non-images", () => {
    expect(validateImage({ type: "application/pdf", size: 1 }).ok).toBe(false);
  });
  it("rejects images over 5 MB", () => {
    expect(validateImage({ type: "image/png", size: 6 * MB }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, confirm it FAILS**

Run: `npm test`
Expected: FAIL — `@/lib/upload` does not exist.

- [ ] **Step 3: Implement `src/lib/upload.ts`**

```ts
import { createClient } from "@/lib/supabase/client";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export type UploadCheck = { ok: true } | { ok: false; error: string };

export function validateImage(file: { type: string; size: number }): UploadCheck {
  if (!ALLOWED.includes(file.type)) {
    return { ok: false, error: "Only PNG, JPEG, GIF, or WebP images" };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "Image must be 5 MB or smaller" };
  }
  return { ok: true };
}

export async function uploadImage(file: File): Promise<{ url: string } | { error: string }> {
  const check = validateImage(file);
  if (!check.ok) return { error: check.error };
  const supabase = createClient();
  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from("attachments")
    .upload(path, file, { contentType: file.type });
  if (error) return { error: "Upload failed — try again" };
  const { data } = supabase.storage.from("attachments").getPublicUrl(path);
  return { url: data.publicUrl };
}
```

- [ ] **Step 4: Run test, confirm it PASSES**

Run: `npm test`
Expected: PASS (all validateImage cases plus the existing suites).

- [ ] **Step 5: Commit**

```bash
git add src/lib/upload.ts tests/upload.test.ts
git commit -m "feat: add image upload helper with validation tests"
```

---

## Task 4: Reaction aggregation helper (TDD)

**Files:**
- Create: `src/lib/reactions.ts`
- Test: `tests/reactions.test.ts`

- [ ] **Step 1: Write the failing test `tests/reactions.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { aggregateReactions } from "@/lib/reactions";
import type { Reaction } from "@/types/db";

function r(user_id: string, emoji: string): Reaction {
  return { message_id: "m1", user_id, emoji, created_at: "2026-06-05T00:00:00Z" };
}

describe("aggregateReactions", () => {
  it("counts reactions per emoji", () => {
    const pills = aggregateReactions([r("a", "👍"), r("b", "👍"), r("c", "❤️")], "z");
    expect(pills).toContainEqual({ emoji: "👍", count: 2, mine: false });
    expect(pills).toContainEqual({ emoji: "❤️", count: 1, mine: false });
  });
  it("marks mine when the current user reacted", () => {
    const pills = aggregateReactions([r("a", "👍"), r("me", "👍")], "me");
    expect(pills).toEqual([{ emoji: "👍", count: 2, mine: true }]);
  });
  it("returns an empty array for no reactions", () => {
    expect(aggregateReactions([], "me")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test, confirm it FAILS**

Run: `npm test`
Expected: FAIL — `@/lib/reactions` does not exist.

- [ ] **Step 3: Implement `src/lib/reactions.ts`**

```ts
import type { Reaction } from "@/types/db";

export type ReactionPill = { emoji: string; count: number; mine: boolean };

export function aggregateReactions(rows: Reaction[], currentUserId: string): ReactionPill[] {
  const byEmoji = new Map<string, ReactionPill>();
  for (const row of rows) {
    const pill = byEmoji.get(row.emoji) ?? { emoji: row.emoji, count: 0, mine: false };
    pill.count += 1;
    if (row.user_id === currentUserId) pill.mine = true;
    byEmoji.set(row.emoji, pill);
  }
  return [...byEmoji.values()];
}
```

- [ ] **Step 4: Run test, confirm it PASSES**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reactions.ts tests/reactions.test.ts
git commit -m "feat: add reaction aggregation helper with tests"
```

---

## Task 5: Markdown rendering (MessageContent)

**Files:**
- Create: `src/components/MessageContent.tsx`
- Modify: `src/components/MessageItem.tsx`
- Modify: `package.json` (new deps)

- [ ] **Step 1: Install the markdown libraries**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/mallow/projects/website && npm install react-markdown remark-gfm`

- [ ] **Step 2: Create `src/components/MessageContent.tsx`**

```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "@/types/db";

// Discord-style subset. Anything not in this list renders as plain text.
const ALLOWED = ["p", "strong", "em", "del", "code", "pre", "blockquote", "a", "ul", "ol", "li", "br"];

export function MessageContent({ msg }: { msg: Message }) {
  return (
    <div className="text-[#dbdee1] break-words">
      {msg.content && (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          allowedElements={ALLOWED}
          unwrapDisallowed
          components={{
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#5865f2] underline">
                {children}
              </a>
            ),
          }}
        >
          {msg.content}
        </ReactMarkdown>
      )}
      {msg.image_url && (
        <a href={msg.image_url} target="_blank" rel="noopener noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={msg.image_url} alt="attachment" className="mt-1 max-h-80 max-w-sm rounded" />
        </a>
      )}
      {msg.updated_at && <span className="text-xs text-[#949ba4] ml-1">(edited)</span>}
    </div>
  );
}
```

- [ ] **Step 3: Update `src/components/MessageItem.tsx` to use it**

Replace the plain content line. The file currently ends its render with:
```tsx
      <div className="text-[#dbdee1] whitespace-pre-wrap break-words">{msg.content}</div>
```
Replace that single line with:
```tsx
      <MessageContent msg={msg} />
```
And add the import at the top (after the existing imports):
```tsx
import { MessageContent } from "@/components/MessageContent";
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: success; messages still render (now via markdown).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/components/MessageContent.tsx src/components/MessageItem.tsx
git commit -m "feat: render messages with Discord-style markdown + inline image"
```

---

## Task 6: Realtime edits & deletes (useMessages)

**Files:**
- Modify: `src/hooks/useMessages.ts`

- [ ] **Step 1: Replace the subscription block in `src/hooks/useMessages.ts`**

Find the existing block that starts `const channel = supabase` and ends with the `.subscribe(...)` call (the INSERT-only handler). Replace that whole block with:

```ts
    const channel = supabase
      .channel(`messages:${column}:${value}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `${column}=eq.${value}` },
        (payload) =>
          setMessages((prev) =>
            prev.some((m) => m.id === (payload.new as Message).id)
              ? prev
              : [...prev, payload.new as Message]
          )
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `${column}=eq.${value}` },
        (payload) =>
          setMessages((prev) =>
            prev.map((m) => (m.id === (payload.new as Message).id ? (payload.new as Message) : m))
          )
      )
      .on(
        // DELETE payloads carry only the primary key (id); they can't be column-filtered,
        // so filter client-side by whether the id is in the current list.
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "messages" },
        (payload) =>
          setMessages((prev) => prev.filter((m) => m.id !== (payload.old as { id: string }).id))
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") load();
      });
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useMessages.ts
git commit -m "feat: reflect message edits and deletes in realtime"
```

---

## Task 7: Edit & delete UI

**Files:**
- Create: `src/components/MessageActions.tsx`
- Modify: `src/components/MessageItem.tsx`

- [ ] **Step 1: Create `src/components/MessageActions.tsx`**

```tsx
"use client";

export function MessageActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="absolute right-2 top-0 hidden group-hover:flex gap-1 bg-[#2b2d31] rounded px-1 py-0.5 text-sm">
      <button onClick={onEdit} title="Edit" className="text-[#949ba4] hover:text-white">✏️</button>
      <button onClick={onDelete} title="Delete" className="text-[#949ba4] hover:text-white">🗑️</button>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `src/components/MessageItem.tsx`** with the full contents below (adds client interactivity, edit mode, and the hover actions). This replaces the whole file:

```tsx
"use client";

import { useState } from "react";
import type { Message } from "@/types/db";
import { formatTime } from "@/lib/format";
import { useAuth } from "@/components/providers/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import { validateMessage } from "@/lib/validation";
import { MessageContent } from "@/components/MessageContent";
import { MessageActions } from "@/components/MessageActions";

export function MessageItem({
  msg,
  authorName,
  showHeader,
}: {
  msg: Message;
  authorName: string;
  showHeader: boolean;
}) {
  const { user } = useAuth();
  const supabase = createClient();
  const isMine = user?.id === msg.author_id;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.content);
  const [error, setError] = useState<string | null>(null);

  async function saveEdit() {
    const v = validateMessage(draft);
    if (!v.ok && !msg.image_url) return setError(v.error);
    const newContent = v.ok ? v.value : "";
    const { error: err } = await supabase
      .from("messages")
      .update({ content: newContent, updated_at: new Date().toISOString() })
      .eq("id", msg.id);
    if (err) return setError("Couldn't save — try again");
    setEditing(false);
    setError(null);
  }

  async function remove() {
    if (!confirm("Delete this message?")) return;
    await supabase.from("messages").delete().eq("id", msg.id);
  }

  return (
    <div className={`group relative px-4 hover:bg-black/10 ${showHeader ? "mt-3 pt-0.5" : ""}`}>
      {showHeader && (
        <div>
          <span className="font-semibold text-white">{authorName}</span>
          <span className="text-xs text-[#949ba4] ml-2">{formatTime(msg.created_at)}</span>
        </div>
      )}
      {editing ? (
        <div>
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                saveEdit();
              }
              if (e.key === "Escape") {
                setEditing(false);
                setDraft(msg.content);
                setError(null);
              }
            }}
            className="w-full p-2 rounded bg-[#383a40] text-[#dbdee1] outline-none"
          />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <p className="text-xs text-[#949ba4]">Enter to save · Esc to cancel</p>
        </div>
      ) : (
        <MessageContent msg={msg} />
      )}
      {isMine && !editing && (
        <MessageActions
          onEdit={() => {
            setDraft(msg.content);
            setEditing(true);
          }}
          onDelete={remove}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/components/MessageActions.tsx src/components/MessageItem.tsx
git commit -m "feat: edit and delete your own messages"
```

---

## Task 8: Reactions UI (useReactions + ReactionBar)

**Files:**
- Create: `src/hooks/useReactions.ts`
- Create: `src/components/ReactionBar.tsx`
- Modify: `src/components/MessageList.tsx`
- Modify: `src/components/MessageItem.tsx`

- [ ] **Step 1: Create `src/hooks/useReactions.ts`**

```ts
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Reaction } from "@/types/db";
import { aggregateReactions, type ReactionPill } from "@/lib/reactions";

// Returns a map: messageId -> aggregated reaction pills, kept live.
export function useReactions(messageIds: string[], currentUserId: string): Record<string, ReactionPill[]> {
  const supabase = createClient();
  const [rows, setRows] = useState<Reaction[]>([]);
  const key = messageIds.join(",");

  useEffect(() => {
    if (messageIds.length === 0) {
      setRows([]);
      return;
    }
    let active = true;

    async function load() {
      const { data } = await supabase.from("reactions").select("*").in("message_id", messageIds);
      if (active) setRows(data ?? []);
    }
    load();

    const channel = supabase
      .channel(`reactions:${key}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "reactions" },
        (payload) => {
          const r = payload.new as Reaction;
          if (messageIds.includes(r.message_id)) setRows((prev) => [...prev, r]);
        }
      )
      .on(
        // reactions PK is (message_id, user_id, emoji), so DELETE payloads carry all three.
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "reactions" },
        (payload) => {
          const o = payload.old as Reaction;
          setRows((prev) =>
            prev.filter(
              (x) => !(x.message_id === o.message_id && x.user_id === o.user_id && x.emoji === o.emoji)
            )
          );
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") load();
      });

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [supabase, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const grouped: Record<string, Reaction[]> = {};
  for (const r of rows) (grouped[r.message_id] ??= []).push(r);
  const byMessage: Record<string, ReactionPill[]> = {};
  for (const id of messageIds) byMessage[id] = aggregateReactions(grouped[id] ?? [], currentUserId);
  return byMessage;
}
```

- [ ] **Step 2: Create `src/components/ReactionBar.tsx`**

```tsx
"use client";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import type { Message } from "@/types/db";
import type { ReactionPill } from "@/lib/reactions";

const EMOJI = ["👍", "❤️", "😂", "🎉", "😮", "😢"];

export function ReactionBar({ message, pills }: { message: Message; pills: ReactionPill[] }) {
  const supabase = createClient();
  const { user } = useAuth();

  async function toggle(emoji: string, mine: boolean) {
    if (!user) return;
    if (mine) {
      await supabase
        .from("reactions")
        .delete()
        .eq("message_id", message.id)
        .eq("user_id", user.id)
        .eq("emoji", emoji);
    } else {
      await supabase
        .from("reactions")
        .insert({ message_id: message.id, user_id: user.id, emoji });
    }
  }

  return (
    <div className="flex items-center gap-1 mt-0.5">
      {pills.map((p) => (
        <button
          key={p.emoji}
          onClick={() => toggle(p.emoji, p.mine)}
          className={`text-xs rounded px-1.5 py-0.5 border ${
            p.mine ? "border-[#5865f2] bg-[#5865f2]/20" : "border-transparent bg-black/20"
          }`}
        >
          {p.emoji} {p.count}
        </button>
      ))}
      <div className="hidden group-hover:flex gap-0.5 ml-1">
        {EMOJI.map((e) => (
          <button
            key={e}
            title={`React ${e}`}
            onClick={() => toggle(e, pills.find((p) => p.emoji === e)?.mine ?? false)}
            className="text-xs opacity-50 hover:opacity-100"
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Thread pills through `src/components/MessageList.tsx`**

Add these imports after the existing imports:
```tsx
import { useAuth } from "@/components/providers/AuthProvider";
import { useReactions } from "@/hooks/useReactions";
```
Inside `MessageList`, after the `const bottom = useRef<HTMLDivElement>(null);` line, add:
```tsx
  const { user } = useAuth();
  const reactionsByMessage = useReactions(messages.map((m) => m.id), user?.id ?? "");
```
Then in the `.map(...)` render, change the `<MessageItem .../>` call to also pass pills:
```tsx
          <MessageItem
            key={m.id}
            msg={m}
            authorName={names[m.author_id] ?? "…"}
            showHeader={showHeader}
            pills={reactionsByMessage[m.id] ?? []}
          />
```

- [ ] **Step 4: Render the bar in `src/components/MessageItem.tsx`**

Add the import after the other imports:
```tsx
import { ReactionBar } from "@/components/ReactionBar";
import type { ReactionPill } from "@/lib/reactions";
```
Change the component's prop type to include `pills`:
```tsx
export function MessageItem({
  msg,
  authorName,
  showHeader,
  pills,
}: {
  msg: Message;
  authorName: string;
  showHeader: boolean;
  pills: ReactionPill[];
}) {
```
Then, immediately before the closing `{isMine && !editing && (` block in the JSX, add the bar so it shows under the content:
```tsx
      {!editing && <ReactionBar message={msg} pills={pills} />}
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: success.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useReactions.ts src/components/ReactionBar.tsx src/components/MessageList.tsx src/components/MessageItem.tsx
git commit -m "feat: emoji reactions with live-updating pills"
```

---

## Task 9: Image attach in the composer

**Files:**
- Modify: `src/components/MessageInput.tsx`

- [ ] **Step 1: Replace the entire contents of `src/components/MessageInput.tsx`**

```tsx
"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { validateMessage } from "@/lib/validation";
import { uploadImage } from "@/lib/upload";

type Target = { channel_id: string } | { conversation_id: string };

export function MessageInput({ target, placeholder }: { target: Target; placeholder: string }) {
  const supabase = createClient();
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (uploading) return;
    const v = validateMessage(text);
    if (!v.ok) return setError(v.error);
    setError(null);
    const draft = v.value;
    setText(""); // optimistic clear
    const { error: err } = await supabase
      .from("messages")
      .insert({ author_id: user!.id, content: draft, ...target });
    if (err) {
      setText(draft);
      setError("Failed to send — try again");
    }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be picked again later
    if (!file) return;
    setError(null);
    setUploading(true);
    const result = await uploadImage(file);
    setUploading(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    const content = text.trim(); // optional caption
    setText("");
    const { error: err } = await supabase
      .from("messages")
      .insert({ author_id: user!.id, content, image_url: result.url, ...target });
    if (err) setError("Failed to send image — try again");
  }

  return (
    <form onSubmit={send} className="p-3">
      {error && <p className="text-red-400 text-sm mb-1">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="text-[#949ba4] hover:text-white"
          title="Attach image"
        >
          📎
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={uploading ? "Uploading…" : placeholder}
          className="flex-1 p-2 rounded bg-[#383a40] text-[#dbdee1] outline-none"
        />
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/components/MessageInput.tsx
git commit -m "feat: attach and send inline images"
```

---

## Task 10: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full test + build**

Run:
```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/mallow/projects/website
npm test
npm run build
```
Expected: all unit tests pass; build clean.

- [ ] **Step 2: Backend smoke test of the new RLS** (temporary script; delete after)

Create `smoke-rich.cjs`:
```js
const { createClient } = require("@supabase/supabase-js");
const { randomUUID } = require("crypto");
const sb = createClient(process.env.SB_URL, process.env.SB_KEY);
(async () => {
  const s = Date.now();
  const { data: up } = await sb.auth.signUp({ email: `rich.${s}@gmail.com`, password: "TestPass123!" });
  if (!up.session) return console.log(">> no session (email confirmation on?)");
  const uid = up.user.id;
  await sb.from("profiles").insert({ id: uid, username: "rich" + (s % 100000), display_name: "Rich Test" });
  const { data: gen } = await sb.from("channels").select("id").eq("name", "general").single();
  const { data: msg, error: me } = await sb.from("messages")
    .insert({ author_id: uid, channel_id: gen.id, content: "hello **world**" }).select("id").single();
  console.log("send:", me ? "ERR " + me.message : "OK");
  const { error: ee } = await sb.from("messages").update({ content: "edited", updated_at: new Date().toISOString() }).eq("id", msg.id);
  console.log("edit own:", ee ? "ERR " + ee.message : "OK");
  const { error: re } = await sb.from("reactions").insert({ message_id: msg.id, user_id: uid, emoji: "👍" });
  console.log("react:", re ? "ERR " + re.message : "OK");
  const { error: ure } = await sb.from("reactions").delete().eq("message_id", msg.id).eq("user_id", uid).eq("emoji", "👍");
  console.log("unreact:", ure ? "ERR " + ure.message : "OK");
  const { error: de } = await sb.from("messages").delete().eq("id", msg.id);
  console.log("delete own:", de ? "ERR " + de.message : "OK");
  console.log("SMOKE_DONE");
})();
```
Run:
```bash
set -a; . ./.env.local; set +a
SB_URL="$NEXT_PUBLIC_SUPABASE_URL" SB_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" node smoke-rich.cjs
rm -f smoke-rich.cjs
```
Expected: `send/edit own/react/unreact/delete own` all `OK`, then `SMOKE_DONE`. If any line is `ERR`, fix the corresponding RLS policy before continuing.

- [ ] **Step 3: Manual checklist in the browser** (`npm run dev`, two browsers)

  - Send a message with markdown (`**bold**`, `*italic*`, `` `code` ``, a URL) → renders formatted, link opens in new tab.
  - Edit your message → "(edited)" appears, updates live in the other browser.
  - Delete your message → disappears in both browsers.
  - You cannot see edit/delete actions on the *other* user's messages.
  - Add and remove reactions → pill counts update live in both browsers; your own reactions are highlighted.
  - Attach an image (≤5 MB) → it uploads and shows inline in both browsers.
  - Send an image with no text → works (image-only message).
  - Try a >5 MB or non-image file → blocked with an inline error.
  - Stop the dev server when done.

- [ ] **Step 4: Done.** All rich-messaging slice features are implemented and verified.

---

## Done Criteria

- Authors can edit/delete only their own messages; both propagate live.
- Messages render the Discord-style markdown subset safely; links open in a new tab.
- Emoji reactions toggle and update live as pills with counts and an own-reaction highlight.
- Images (≤5 MB, images only) upload and display inline; image-only messages work.
- New unit tests pass; backend smoke test of the new RLS passes; manual checklist passes.

When complete, the next slice is the remainder of rich messaging (replies, mentions, pins, threads, link previews, non-image files), each via its own brainstorm → spec → plan cycle.
