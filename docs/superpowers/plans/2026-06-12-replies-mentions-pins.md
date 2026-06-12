# Replies, Mentions & Pins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add message replies (with a quoted preview and an @-ping toggle), @mentions (autocomplete + highlighting), and pinned messages to the existing chat app.

**Architecture:** Extends the `messages` table with reply/pin columns and a `toggle_pin` security-definer function; renders mentions through a small custom remark plugin in the existing react-markdown pipeline; resolves reply previews client-side from the already-loaded message list; reuses the existing realtime message INSERT/UPDATE handlers (no new subscriptions). Pure logic (mention parsing, "mentions me") lives in a tested helper.

**Tech Stack:** Next.js 16 + TypeScript, Supabase (Postgres + RLS + Realtime), react-markdown, Vitest.

---

## Prerequisites (manual)

- [ ] **P1: Node on PATH** — `node --version` (v20+). If missing: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"`.
- [ ] **P2: Supabase project active** — open the dashboard; if paused, Resume.

## File Structure

```
website/
  supabase/migrations/0003_replies_mentions_pins.sql   # NEW: columns + toggle_pin fn
  src/
    types/db.ts                                         # MODIFY: Message gains reply/pin fields
    lib/mentions.ts                                     # NEW: remark plugin + pure helpers
    components/
      providers/AuthProvider.tsx                        # MODIFY: expose current user's profile
      MessageContent.tsx                                # MODIFY: render @mention pills
      MessageActions.tsx                                # MODIFY: reply + pin + edit/delete bar
      MessageItem.tsx                                   # MODIFY: reply preview, highlight, pin
      MessageList.tsx                                   # MODIFY: resolve reply targets, forward onReply
      MessageInput.tsx                                  # MODIFY: reply bar + @ON/OFF + autocomplete
      MentionAutocomplete.tsx                           # NEW: @ username dropdown
      PinnedPanel.tsx                                   # NEW: pinned-messages popover
    app/(app)/channels/[channelId]/page.tsx             # MODIFY: reply state + pinned header
    app/(app)/dms/[conversationId]/page.tsx             # MODIFY: reply state + pinned header
  tests/mentions.test.ts                                # NEW
```

---

## Task 1: Migration + types

**Files:**
- Create: `supabase/migrations/0003_replies_mentions_pins.sql`
- Modify: `src/types/db.ts`

- [ ] **Step 1: Write `supabase/migrations/0003_replies_mentions_pins.sql`**

```sql
-- replies + pins columns on messages
alter table public.messages add column if not exists reply_to_id uuid references public.messages(id) on delete set null;
alter table public.messages add column if not exists mention_author boolean not null default true;
alter table public.messages add column if not exists pinned boolean not null default false;
alter table public.messages add column if not exists pinned_at timestamptz;
create index if not exists messages_pinned_idx on public.messages (channel_id, pinned);

-- pin/unpin via a function: anyone who can read the message may toggle its pin,
-- without granting broad UPDATE (which would let non-authors edit content).
create or replace function public.toggle_pin(msg uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_read_message(msg) then
    raise exception 'not allowed';
  end if;
  update public.messages
    set pinned = not pinned,
        pinned_at = case when not pinned then now() else null end
    where id = msg;
end; $$;

grant execute on function public.toggle_pin(uuid) to authenticated;
```

- [ ] **Step 2: Run it in Supabase** (SQL Editor → New query → paste → Run). Expected: "Success. No rows returned." Verify `messages` now has `reply_to_id`, `mention_author`, `pinned`, `pinned_at` columns.

- [ ] **Step 3: Update `src/types/db.ts`** — replace the `Message` type with:

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
  reply_to_id: string | null;
  mention_author: boolean;
  pinned: boolean;
  pinned_at: string | null;
};
```
(Leave `Profile`, `Channel`, `Reaction` unchanged.)

- [ ] **Step 4: Verify build** — `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/mallow/projects/website && npm run build`. Expected: success.

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/0003_replies_mentions_pins.sql src/types/db.ts
git commit -m "feat: add reply/pin schema + toggle_pin function"
```

---

## Task 2: Expose the current user's profile from AuthProvider

**Files:**
- Modify: `src/components/providers/AuthProvider.tsx`

Mentions need the current user's username. The provider currently exposes only the auth user.

- [ ] **Step 1: Replace the entire contents of `src/components/providers/AuthProvider.tsx`** with:

```tsx
"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/types/db";

type AuthState = {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
};
const AuthContext = createContext<AuthState>({
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      return;
    }
    supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single()
      .then(({ data }) => setProfile((data as Profile) ?? null));
  }, [supabase, user]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
```

- [ ] **Step 2: Verify build** — `npm run build`. Expected: success (existing `useAuth()` consumers ignore the new `profile` field).

- [ ] **Step 3: Commit**
```bash
git add src/components/providers/AuthProvider.tsx
git commit -m "feat: expose current user's profile from AuthProvider"
```

---

## Task 3: Mention logic (TDD)

**Files:**
- Create: `src/lib/mentions.ts`
- Test: `tests/mentions.test.ts`

- [ ] **Step 1: Write the failing test `tests/mentions.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { extractMentions, mentionsMe } from "@/lib/mentions";

describe("extractMentions", () => {
  it("finds @usernames", () => {
    expect(extractMentions("hey @sam and @alex_2")).toEqual(["sam", "alex_2"]);
  });
  it("ignores an email-like a@b", () => {
    expect(extractMentions("mail me at me@example")).toEqual([]);
  });
  it("returns empty for no mentions", () => {
    expect(extractMentions("just text")).toEqual([]);
  });
});

describe("mentionsMe", () => {
  const base = {
    content: "",
    myUsername: "sam",
    myId: "me",
    replyToId: null as string | null,
    mentionAuthor: false,
    repliedToAuthorId: null as string | null,
  };
  it("true when my username is mentioned (case-insensitive)", () => {
    expect(mentionsMe({ ...base, content: "yo @Sam" })).toBe(true);
  });
  it("true for a ping-reply to my own message", () => {
    expect(mentionsMe({ ...base, replyToId: "m1", mentionAuthor: true, repliedToAuthorId: "me" })).toBe(true);
  });
  it("false for a ping-reply to someone else's message", () => {
    expect(mentionsMe({ ...base, replyToId: "m1", mentionAuthor: true, repliedToAuthorId: "other" })).toBe(false);
  });
  it("false when the reply ping is off", () => {
    expect(mentionsMe({ ...base, replyToId: "m1", mentionAuthor: false, repliedToAuthorId: "me" })).toBe(false);
  });
  it("false when nothing matches", () => {
    expect(mentionsMe({ ...base, content: "hi @alex" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run, confirm it FAILS** — `npm test`. Expected: FAIL (`@/lib/mentions` missing).

- [ ] **Step 3: Implement `src/lib/mentions.ts`**

```ts
// Matches @username not preceded by a word char (so emails like a@b don't match).
const MENTION_RE = /(?<![a-zA-Z0-9_])@([a-zA-Z0-9_]{2,32})/g;

export function extractMentions(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(MENTION_RE)) out.push(m[1]);
  return out;
}

export function mentionsMe(opts: {
  content: string;
  myUsername: string | null;
  myId: string | null;
  replyToId: string | null;
  mentionAuthor: boolean;
  repliedToAuthorId: string | null;
}): boolean {
  const { content, myUsername, myId, replyToId, mentionAuthor, repliedToAuthorId } = opts;
  if (myUsername) {
    const lower = myUsername.toLowerCase();
    if (extractMentions(content).some((u) => u.toLowerCase() === lower)) return true;
  }
  if (replyToId && mentionAuthor && myId && repliedToAuthorId === myId) return true;
  return false;
}

// remark plugin: turn @username text into a link node with a `mention:` url,
// which MessageContent renders as a styled pill. Skips code (code nodes hold
// their text in `value`, not child text nodes, so they're never visited here).
type MdNode = { type: string; value?: string; url?: string; children?: MdNode[] };

export function remarkMentions() {
  return (tree: MdNode) => {
    walk(tree);
  };
}

function walk(node: MdNode): void {
  if (!node.children) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && child.value) {
      next.push(...splitText(child.value));
    } else {
      walk(child);
      next.push(child);
    }
  }
  node.children = next;
}

function splitText(value: string): MdNode[] {
  const out: MdNode[] = [];
  let last = 0;
  for (const m of value.matchAll(MENTION_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ type: "text", value: value.slice(last, idx) });
    out.push({ type: "link", url: `mention:${m[1]}`, children: [{ type: "text", value: `@${m[1]}` }] });
    last = idx + m[0].length;
  }
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out.length ? out : [{ type: "text", value }];
}
```

- [ ] **Step 4: Run, confirm it PASSES** — `npm test`. Expected: all pass (8 new assertions + existing suites).

- [ ] **Step 5: Commit**
```bash
git add src/lib/mentions.ts tests/mentions.test.ts
git commit -m "feat: add mention parsing + mentions-me helper with tests"
```

---

## Task 4: Render @mention pills in MessageContent

**Files:**
- Modify: `src/components/MessageContent.tsx`

- [ ] **Step 1: Replace the entire contents of `src/components/MessageContent.tsx`** with:

```tsx
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import type { Message } from "@/types/db";
import { remarkMentions } from "@/lib/mentions";

// Discord-style subset. Anything not in this list renders as plain text.
const ALLOWED = ["p", "strong", "em", "del", "code", "pre", "blockquote", "a", "ul", "ol", "li", "br", "h1", "h2", "h3"];

// Only allow http(s) image URLs (image_url is column data, not RLS-validated).
function isHttpUrl(u: string): boolean {
  try {
    const proto = new URL(u).protocol;
    return proto === "http:" || proto === "https:";
  } catch {
    return false;
  }
}

export function MessageContent({ msg }: { msg: Message }) {
  const safeImage = msg.image_url && isHttpUrl(msg.image_url) ? msg.image_url : null;
  return (
    <div className="text-[#dbdee1] break-words">
      {msg.content && (
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkBreaks, remarkMentions]}
          allowedElements={ALLOWED}
          unwrapDisallowed
          urlTransform={(url) => (url.startsWith("mention:") ? url : defaultUrlTransform(url))}
          components={{
            a: ({ href, children }) => {
              if (href?.startsWith("mention:")) {
                return (
                  <span className="bg-[#3c4270] text-[#c9cdfb] rounded px-1 font-medium">{children}</span>
                );
              }
              return (
                <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#5865f2] underline">
                  {children}
                </a>
              );
            },
            h1: ({ children }) => <h1 className="text-xl font-bold mt-1">{children}</h1>,
            h2: ({ children }) => <h2 className="text-lg font-bold mt-1">{children}</h2>,
            h3: ({ children }) => <h3 className="text-base font-bold mt-1">{children}</h3>,
          }}
        >
          {msg.content}
        </ReactMarkdown>
      )}
      {safeImage && (
        <a href={safeImage} target="_blank" rel="noopener noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={safeImage} alt="attachment" className="mt-1 max-h-80 max-w-sm rounded" />
        </a>
      )}
      {msg.updated_at && <span className="text-xs text-[#949ba4] ml-1">(edited)</span>}
    </div>
  );
}
```

- [ ] **Step 2: Verify build** — `npm run build`. Expected: success. (If `defaultUrlTransform` is not exported by the installed react-markdown major version, the build will error on the import; in that case report BLOCKED — do not guess an alternative.)

- [ ] **Step 3: Commit**
```bash
git add src/components/MessageContent.tsx
git commit -m "feat: render @mentions as pills in messages"
```

---

## Task 5: Reply preview, mentions-me highlight, and pin in MessageItem

**Files:**
- Modify: `src/components/MessageActions.tsx`
- Modify: `src/components/MessageItem.tsx`
- Modify: `src/components/MessageList.tsx`

- [ ] **Step 1: Replace `src/components/MessageActions.tsx`** with a general action bar (reply + pin always; edit/delete only when allowed):

```tsx
"use client";

export function MessageActions({
  onReply,
  onPin,
  pinned,
  canEdit,
  onEdit,
  onDelete,
}: {
  onReply: () => void;
  onPin: () => void;
  pinned: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="absolute right-2 top-0 hidden group-hover:flex gap-1 bg-[#2b2d31] rounded px-1 py-0.5 text-sm">
      <button onClick={onReply} title="Reply" className="text-[#949ba4] hover:text-white">↩️</button>
      <button onClick={onPin} title={pinned ? "Unpin" : "Pin"} className="text-[#949ba4] hover:text-white">📌</button>
      {canEdit && (
        <>
          <button onClick={onEdit} title="Edit" className="text-[#949ba4] hover:text-white">✏️</button>
          <button onClick={onDelete} title="Delete" className="text-[#949ba4] hover:text-white">🗑️</button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Replace `src/components/MessageItem.tsx`** with:

```tsx
"use client";

import { useMemo, useState } from "react";
import type { Message } from "@/types/db";
import { formatTime } from "@/lib/format";
import { useAuth } from "@/components/providers/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import { validateMessage } from "@/lib/validation";
import { mentionsMe } from "@/lib/mentions";
import { MessageContent } from "@/components/MessageContent";
import { MessageActions } from "@/components/MessageActions";
import { ReactionBar } from "@/components/ReactionBar";
import type { ReactionPill } from "@/lib/reactions";

function snippet(m: Message): string {
  if (m.content) return m.content.length > 60 ? m.content.slice(0, 60) + "…" : m.content;
  if (m.image_url) return "📷 image";
  return "";
}

export function MessageItem({
  msg,
  authorName,
  showHeader,
  pills,
  repliedTo,
  repliedToName,
  onReply,
}: {
  msg: Message;
  authorName: string;
  showHeader: boolean;
  pills: ReactionPill[];
  repliedTo: Message | null;
  repliedToName?: string;
  onReply?: (m: Message, authorName: string) => void;
}) {
  const { user, profile } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const isMine = user?.id === msg.author_id;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.content);
  const [error, setError] = useState<string | null>(null);

  const highlighted =
    !isMine &&
    mentionsMe({
      content: msg.content,
      myUsername: profile?.username ?? null,
      myId: user?.id ?? null,
      replyToId: msg.reply_to_id,
      mentionAuthor: msg.mention_author,
      repliedToAuthorId: repliedTo?.author_id ?? null,
    });

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
    const { error: err } = await supabase.from("messages").delete().eq("id", msg.id);
    if (err) setError("Couldn't delete — try again");
  }

  async function togglePin() {
    const { error: err } = await supabase.rpc("toggle_pin", { msg: msg.id });
    if (err) setError("Couldn't pin — try again");
  }

  function jumpToOriginal() {
    if (repliedTo) document.getElementById(`msg-${repliedTo.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div
      id={`msg-${msg.id}`}
      className={`group relative px-4 hover:bg-black/10 ${showHeader ? "mt-3 pt-0.5" : ""} ${
        highlighted ? "bg-[#faa61a]/10 border-l-2 border-[#faa61a]" : ""
      }`}
    >
      {msg.reply_to_id && (
        <div
          onClick={jumpToOriginal}
          className="flex items-center gap-1 text-[11px] text-[#949ba4] mb-0.5 cursor-pointer"
        >
          <span className="text-[#6d6f78]">↰</span>
          {repliedTo ? (
            <>
              {msg.mention_author ? (
                <span className="bg-[#3c4270] text-[#c9cdfb] rounded px-1 font-medium">@{repliedToName ?? "user"}</span>
              ) : (
                <span className="text-[#c9ccd1] font-semibold">{repliedToName ?? "user"}</span>
              )}
              <span className="truncate">{snippet(repliedTo)}</span>
            </>
          ) : (
            <span className="italic">Original message</span>
          )}
        </div>
      )}

      {showHeader && (
        <div>
          <span className="font-semibold text-white">{authorName}</span>
          <span className="text-xs text-[#949ba4] ml-2">{formatTime(msg.created_at)}</span>
          {msg.pinned && <span className="text-xs text-[#949ba4] ml-2" title="Pinned">📌</span>}
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
      {error && !editing && <p className="text-red-400 text-sm">{error}</p>}

      {!editing && <ReactionBar message={msg} pills={pills} />}
      {!editing && (
        <MessageActions
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
      )}
    </div>
  );
}
```

- [ ] **Step 3: Replace `src/components/MessageList.tsx`** with (resolves reply targets + threads `onReply`):

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Message, Profile } from "@/types/db";
import { MessageItem } from "@/components/MessageItem";
import { startsNewGroup } from "@/lib/grouping";
import { useAuth } from "@/components/providers/AuthProvider";
import { useReactions } from "@/hooks/useReactions";

export function MessageList({
  messages,
  onReply,
}: {
  messages: Message[];
  onReply?: (m: Message, authorName: string) => void;
}) {
  const supabase = createClient();
  const [names, setNames] = useState<Record<string, string>>({});
  const bottom = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const reactionsByMessage = useReactions(messages.map((m) => m.id), user?.id ?? "");
  const byId = new Map(messages.map((m) => [m.id, m]));

  useEffect(() => {
    const missing = [...new Set(messages.map((m) => m.author_id))].filter((id) => !names[id]);
    if (missing.length === 0) return;
    supabase.from("profiles").select("*").in("id", missing).then(({ data }) => {
      const next: Record<string, string> = {};
      (data as Profile[] | null)?.forEach((p) => (next[p.id] = p.display_name));
      setNames((prev) => ({ ...prev, ...next }));
    });
  }, [messages, names, supabase]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex-1 overflow-y-auto py-3">
      {messages.map((m, i) => {
        const showHeader = startsNewGroup(messages[i - 1], m);
        const repliedTo = m.reply_to_id ? byId.get(m.reply_to_id) ?? null : null;
        return (
          <MessageItem
            key={m.id}
            msg={m}
            authorName={names[m.author_id] ?? "…"}
            showHeader={showHeader}
            pills={reactionsByMessage[m.id] ?? []}
            repliedTo={repliedTo}
            repliedToName={repliedTo ? names[repliedTo.author_id] : undefined}
            onReply={onReply}
          />
        );
      })}
      <div ref={bottom} />
    </div>
  );
}
```

- [ ] **Step 4: Verify build + tests** — `npm run build` and `npm test`. Expected: both pass. (Pages still call `<MessageList messages={...} />` without `onReply`; that's fine — it's optional. The reply button is a no-op until Task 6.)

- [ ] **Step 5: Commit**
```bash
git add src/components/MessageActions.tsx src/components/MessageItem.tsx src/components/MessageList.tsx
git commit -m "feat: reply previews, mentions-me highlight, pin action on messages"
```

---

## Task 6: Reply flow (compose a reply)

**Files:**
- Modify: `src/components/MessageInput.tsx`
- Modify: `src/app/(app)/channels/[channelId]/page.tsx`
- Modify: `src/app/(app)/dms/[conversationId]/page.tsx`

- [ ] **Step 1: Replace `src/components/MessageInput.tsx`** with (adds reply bar + @ON/OFF toggle; sends reply fields):

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { validateMessage } from "@/lib/validation";
import { uploadImage } from "@/lib/upload";
import type { Message } from "@/types/db";

type Target = { channel_id: string } | { conversation_id: string };

export function MessageInput({
  target,
  placeholder,
  replyTo,
  replyToName,
  onClearReply,
}: {
  target: Target;
  placeholder: string;
  replyTo?: Message | null;
  replyToName?: string;
  onClearReply?: () => void;
}) {
  const supabase = createClient();
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pingAuthor, setPingAuthor] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  // Default the ping back ON each time a new reply target is chosen.
  useEffect(() => {
    setPingAuthor(true);
  }, [replyTo?.id]);

  function replyFields() {
    return replyTo ? { reply_to_id: replyTo.id, mention_author: pingAuthor } : {};
  }

  async function submit() {
    if (uploading) return;
    const v = validateMessage(text);
    if (!v.ok) return setError(v.error);
    setError(null);
    const draft = v.value;
    setText("");
    const { error: err } = await supabase
      .from("messages")
      .insert({ author_id: user!.id, content: draft, ...replyFields(), ...target });
    if (err) {
      setText(draft);
      setError("Failed to send — try again");
      return;
    }
    onClearReply?.();
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    submit();
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setUploading(true);
    const result = await uploadImage(file);
    setUploading(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    const content = text.trim();
    setText("");
    const { error: err } = await supabase
      .from("messages")
      .insert({ author_id: user!.id, content, image_url: result.url, ...replyFields(), ...target });
    if (err) {
      setError("Failed to send image — try again");
      return;
    }
    onClearReply?.();
  }

  return (
    <form onSubmit={send} className="p-3">
      {error && <p className="text-red-400 text-sm mb-1">{error}</p>}
      {replyTo && (
        <div className="flex items-center justify-between bg-[#2b2d31] rounded-t-md px-2 py-1 text-[11px] text-[#949ba4]">
          <span>
            Replying to <b className="text-[#c9ccd1]">{replyToName ?? "user"}</b>
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPingAuthor((p) => !p)}
              className={`rounded-full px-2 font-semibold border ${
                pingAuthor ? "border-[#5865f2] bg-[#3c4270] text-[#c9cdfb]" : "border-[#4e5058] text-[#949ba4]"
              }`}
            >
              {pingAuthor ? "@ ON" : "@ OFF"}
            </button>
            <button type="button" onClick={onClearReply} title="Cancel reply" className="hover:text-white">
              ✕
            </button>
          </span>
        </div>
      )}
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
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={uploading ? "Uploading…" : placeholder}
          className="flex-1 p-2 rounded bg-[#383a40] text-[#dbdee1] outline-none resize-none"
        />
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Replace `src/app/(app)/channels/[channelId]/page.tsx`** with (holds reply state):

```tsx
"use client";

import { use, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Channel, Message } from "@/types/db";
import { useMessages } from "@/hooks/useMessages";
import { MessageList } from "@/components/MessageList";
import { MessageInput } from "@/components/MessageInput";

export default function ChannelPage({ params }: { params: Promise<{ channelId: string }> }) {
  const { channelId: name } = use(params);
  const supabase = createClient();
  const [channel, setChannel] = useState<Channel | null>(null);

  useEffect(() => {
    supabase.from("channels").select("*").eq("name", name).single()
      .then(({ data }) => setChannel(data));
  }, [supabase, name]);

  if (!channel) return <div className="p-4 text-[#949ba4]">Loading channel…</div>;
  return <ChannelView channel={channel} />;
}

function ChannelView({ channel }: { channel: Channel }) {
  const messages = useMessages({ channelId: channel.id });
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [replyToName, setReplyToName] = useState("");
  return (
    <>
      <header className="p-3 border-b border-black/30 font-semibold text-white"># {channel.name}</header>
      <MessageList
        messages={messages}
        onReply={(m, name) => {
          setReplyTo(m);
          setReplyToName(name);
        }}
      />
      <MessageInput
        target={{ channel_id: channel.id }}
        placeholder={`Message #${channel.name}`}
        replyTo={replyTo}
        replyToName={replyToName}
        onClearReply={() => setReplyTo(null)}
      />
    </>
  );
}
```

- [ ] **Step 3: Replace `src/app/(app)/dms/[conversationId]/page.tsx`** with:

```tsx
"use client";

import { use, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import type { Profile, Message } from "@/types/db";
import { useMessages } from "@/hooks/useMessages";
import { MessageList } from "@/components/MessageList";
import { MessageInput } from "@/components/MessageInput";

export default function DmPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = use(params);
  const supabase = createClient();
  const { user } = useAuth();
  const [other, setOther] = useState<Profile | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [replyToName, setReplyToName] = useState("");
  const messages = useMessages({ conversationId });

  useEffect(() => {
    if (!user) return;
    supabase
      .from("conversation_members")
      .select("profiles(*)")
      .eq("conversation_id", conversationId)
      .neq("user_id", user.id)
      .single()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data }: any) => setOther(data?.profiles ?? null));
  }, [supabase, conversationId, user]);

  return (
    <>
      <header className="p-3 border-b border-black/30 font-semibold text-white">
        @ {other?.display_name ?? "Direct Message"}
      </header>
      <MessageList
        messages={messages}
        onReply={(m, name) => {
          setReplyTo(m);
          setReplyToName(name);
        }}
      />
      <MessageInput
        target={{ conversation_id: conversationId }}
        placeholder={`Message ${other?.display_name ?? ""}`}
        replyTo={replyTo}
        replyToName={replyToName}
        onClearReply={() => setReplyTo(null)}
      />
    </>
  );
}
```

- [ ] **Step 4: Verify build + tests** — `npm run build`, `npm test`. Expected: both pass.

- [ ] **Step 5: Commit**
```bash
git add "src/components/MessageInput.tsx" "src/app/(app)/channels/[channelId]/page.tsx" "src/app/(app)/dms/[conversationId]/page.tsx"
git commit -m "feat: reply composer with @ON/OFF ping toggle"
```

---

## Task 7: @ mention autocomplete in the composer

**Files:**
- Create: `src/components/MentionAutocomplete.tsx`
- Modify: `src/components/MessageInput.tsx`

- [ ] **Step 1: Create `src/components/MentionAutocomplete.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/types/db";

// Shows username matches for `query`; calls onPick with the chosen username.
// Renders nothing when query is null or there are no matches.
export function MentionAutocomplete({
  query,
  onPick,
}: {
  query: string | null;
  onPick: (username: string) => void;
}) {
  const supabase = createClient();
  const [results, setResults] = useState<Profile[]>([]);

  useEffect(() => {
    if (query === null) {
      setResults([]);
      return;
    }
    let active = true;
    supabase
      .from("profiles")
      .select("*")
      .ilike("username", `${query}%`)
      .limit(6)
      .then(({ data }) => {
        if (active) setResults((data as Profile[]) ?? []);
      });
    return () => {
      active = false;
    };
  }, [supabase, query]);

  if (query === null || results.length === 0) return null;

  return (
    <div className="absolute bottom-14 left-3 w-56 bg-[#111214] border border-white/10 rounded-md p-1 shadow-xl z-50">
      {results.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onPick(p.username)}
          className="w-full text-left px-2 py-1 rounded hover:bg-[#404249] text-[#dbdee1] text-sm"
        >
          {p.display_name} <span className="text-[#949ba4]">@{p.username}</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `src/components/MessageInput.tsx`.** Make these edits to the file from Task 6:

Add the import after the other imports:
```tsx
import { MentionAutocomplete } from "@/components/MentionAutocomplete";
```

Add this helper above the `MessageInput` function (module scope):
```tsx
// The active @mention query is the @-word immediately before the caret, if any.
function mentionQueryAt(text: string, caret: number): string | null {
  const before = text.slice(0, caret);
  const m = before.match(/(?:^|\s)@([a-zA-Z0-9_]*)$/);
  return m ? m[1] : null;
}
```

Inside `MessageInput`, add caret + query state near the other `useState` calls:
```tsx
  const [caret, setCaret] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mentionQuery = mentionQueryAt(text, caret);
```

Add a picker handler inside the component (above the `return`):
```tsx
  function pickMention(username: string) {
    const before = text.slice(0, caret).replace(/@([a-zA-Z0-9_]*)$/, `@${username} `);
    const after = text.slice(caret);
    const next = before + after;
    setText(next);
    setCaret(before.length);
    requestAnimationFrame(() => {
      taRef.current?.focus();
      taRef.current?.setSelectionRange(before.length, before.length);
    });
  }
```

Replace the `<textarea ... />` element with one that tracks the caret and ref (keep the existing className/placeholder/rows; add `ref`, and update caret on change/select/keyup):
```tsx
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyUp={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onClick={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={uploading ? "Uploading…" : placeholder}
          className="flex-1 p-2 rounded bg-[#383a40] text-[#dbdee1] outline-none resize-none"
        />
```

Wrap the returned `<form>`'s outer element so the dropdown can anchor: change the opening `<form onSubmit={send} className="p-3">` to `<form onSubmit={send} className="p-3 relative">`, and add the autocomplete just inside the form, before the `{error && ...}` line:
```tsx
      <MentionAutocomplete query={mentionQuery} onPick={pickMention} />
```

- [ ] **Step 3: Verify build** — `npm run build`. Expected: success. Manually sanity-check the logic by reading: typing `@a` sets `mentionQuery="a"`, the dropdown queries usernames, picking inserts `@username `.

- [ ] **Step 4: Commit**
```bash
git add src/components/MentionAutocomplete.tsx src/components/MessageInput.tsx
git commit -m "feat: @ mention autocomplete in the composer"
```

---

## Task 8: Pinned-messages panel

**Files:**
- Create: `src/components/PinnedPanel.tsx`
- Modify: `src/app/(app)/channels/[channelId]/page.tsx`
- Modify: `src/app/(app)/dms/[conversationId]/page.tsx`

Pinned messages are derived from the live `messages` list (consistent with how reply previews resolve from loaded messages). Limitation: a pinned message older than the loaded window won't appear — acceptable for this scale.

- [ ] **Step 1: Create `src/components/PinnedPanel.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Message, Profile } from "@/types/db";

function snippet(m: Message): string {
  if (m.content) return m.content.length > 80 ? m.content.slice(0, 80) + "…" : m.content;
  if (m.image_url) return "📷 image";
  return "";
}

export function PinnedPanel({ pinned, onClose }: { pinned: Message[]; onClose: () => void }) {
  const supabase = createClient();
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    const ids = [...new Set(pinned.map((m) => m.author_id))];
    if (ids.length === 0) return;
    supabase.from("profiles").select("*").in("id", ids).then(({ data }) => {
      const next: Record<string, string> = {};
      (data as Profile[] | null)?.forEach((p) => (next[p.id] = p.display_name));
      setNames(next);
    });
  }, [supabase, pinned]);

  function jump(id: string) {
    document.getElementById(`msg-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    onClose();
  }

  async function unpin(id: string) {
    await supabase.rpc("toggle_pin", { msg: id });
  }

  return (
    <div className="absolute right-3 top-12 w-72 bg-[#111214] border border-white/10 rounded-lg p-2 shadow-xl z-50">
      <div className="text-white font-bold text-[11px] uppercase mb-2">📌 Pinned Messages</div>
      {pinned.length === 0 && <div className="text-[#949ba4] text-sm px-1 py-2">No pinned messages yet.</div>}
      {[...pinned]
        .sort((a, b) => (b.pinned_at ?? "").localeCompare(a.pinned_at ?? ""))
        .map((m) => (
          <div key={m.id} className="bg-[#2b2d31] rounded-md p-2 text-xs mb-1.5">
            <button onClick={() => unpin(m.id)} title="Unpin" className="float-right text-[#949ba4] hover:text-white">
              ✕
            </button>
            <div className="text-white font-semibold cursor-pointer" onClick={() => jump(m.id)}>
              {names[m.author_id] ?? "…"}
            </div>
            <div className="text-[#dbdee1] cursor-pointer" onClick={() => jump(m.id)}>
              {snippet(m)}
            </div>
          </div>
        ))}
    </div>
  );
}
```

- [ ] **Step 2: Add the pinned button + panel to `ChannelView` in `src/app/(app)/channels/[channelId]/page.tsx`.** Replace the `ChannelView` function with:

```tsx
function ChannelView({ channel }: { channel: Channel }) {
  const messages = useMessages({ channelId: channel.id });
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [replyToName, setReplyToName] = useState("");
  const [showPins, setShowPins] = useState(false);
  const pinned = messages.filter((m) => m.pinned);
  return (
    <>
      <header className="p-3 border-b border-black/30 font-semibold text-white flex items-center justify-between relative">
        <span># {channel.name}</span>
        <button
          onClick={() => setShowPins((s) => !s)}
          className="text-xs font-normal text-[#949ba4] hover:text-white"
        >
          📌 Pinned ({pinned.length})
        </button>
        {showPins && <PinnedPanel pinned={pinned} onClose={() => setShowPins(false)} />}
      </header>
      <MessageList
        messages={messages}
        onReply={(m, name) => {
          setReplyTo(m);
          setReplyToName(name);
        }}
      />
      <MessageInput
        target={{ channel_id: channel.id }}
        placeholder={`Message #${channel.name}`}
        replyTo={replyTo}
        replyToName={replyToName}
        onClearReply={() => setReplyTo(null)}
      />
    </>
  );
}
```

And add the import at the top of the file (after the existing imports):
```tsx
import { PinnedPanel } from "@/components/PinnedPanel";
```

- [ ] **Step 3: Add the pinned button + panel to `src/app/(app)/dms/[conversationId]/page.tsx`.** Add the import after the existing imports:
```tsx
import { PinnedPanel } from "@/components/PinnedPanel";
```
Add pinned state next to the other `useState` calls inside `DmPage`:
```tsx
  const [showPins, setShowPins] = useState(false);
  const pinned = messages.filter((m) => m.pinned);
```
Replace the `<header>...</header>` block with:
```tsx
      <header className="p-3 border-b border-black/30 font-semibold text-white flex items-center justify-between relative">
        <span>@ {other?.display_name ?? "Direct Message"}</span>
        <button
          onClick={() => setShowPins((s) => !s)}
          className="text-xs font-normal text-[#949ba4] hover:text-white"
        >
          📌 Pinned ({pinned.length})
        </button>
        {showPins && <PinnedPanel pinned={pinned} onClose={() => setShowPins(false)} />}
      </header>
```

- [ ] **Step 4: Verify build + tests** — `npm run build`, `npm test`. Expected: both pass.

- [ ] **Step 5: Commit**
```bash
git add src/components/PinnedPanel.tsx "src/app/(app)/channels/[channelId]/page.tsx" "src/app/(app)/dms/[conversationId]/page.tsx"
git commit -m "feat: pinned-messages panel + header count"
```

---

## Task 9: Final verification + merge

**Files:** none (verification)

- [ ] **Step 1: Full test + build** — `npm test` then `npm run build`. Expected: all unit tests pass; build clean.

- [ ] **Step 2: Backend smoke test** of the new column/function under RLS. Create `smoke-rmp.cjs`:
```js
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.SB_URL, process.env.SB_KEY);
(async () => {
  const s = Date.now();
  const { data: up } = await sb.auth.signUp({ email: `rmp.${s}@gmail.com`, password: "TestPass123!" });
  if (!up.session) return console.log(">> no session");
  const uid = up.user.id;
  await sb.from("profiles").insert({ id: uid, username: "rmp" + (s % 100000), display_name: "RMP" });
  const { data: gen } = await sb.from("channels").select("id").eq("name", "general").single();
  const { data: a } = await sb.from("messages").insert({ author_id: uid, channel_id: gen.id, content: "original" }).select("id").single();
  const { error: re } = await sb.from("messages").insert({ author_id: uid, channel_id: gen.id, content: "a reply", reply_to_id: a.id, mention_author: true });
  console.log("reply insert:", re ? "ERR " + re.message : "OK");
  const { error: pe } = await sb.rpc("toggle_pin", { msg: a.id });
  console.log("toggle_pin:", pe ? "ERR " + pe.message : "OK");
  const { data: pinnedRow } = await sb.from("messages").select("pinned").eq("id", a.id).single();
  console.log("pinned now:", pinnedRow?.pinned);
  await sb.from("messages").delete().eq("id", a.id);
  console.log("SMOKE_DONE");
})();
```
Run:
```bash
set -a; . ./.env.local; set +a
SB_URL="$NEXT_PUBLIC_SUPABASE_URL" SB_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" node smoke-rmp.cjs
rm -f smoke-rmp.cjs
```
Expected: `reply insert: OK`, `toggle_pin: OK`, `pinned now: true`, `SMOKE_DONE`.

- [ ] **Step 3: Manual checklist** (`npm run dev`, two browsers):
  - Reply to a message with **@ ON** → the other user (author of the original) sees the reply highlighted; quoted line shows `@name`. You (replier) do NOT see it highlighted.
  - Reply with **@ OFF** → quoted line shows plain name; nobody highlighted.
  - Quoted preview click scrolls to the original.
  - Type `@` + letters → autocomplete shows usernames; picking inserts `@username`; the mention renders as a pill; mentioning another user highlights it for them only.
  - Pin a message (📌) → it appears in the **📌 Pinned (n)** panel and the count updates live in the second browser; unpin removes it.
  - Edit/delete/reactions/images from prior slices still work.
  - Stop the dev server when done.

- [ ] **Step 4: Done.** All replies/mentions/pins features implemented and verified.

---

## Done Criteria

- Replies send with a working quoted preview and the @ ON/OFF ping toggle; only the pinged author sees the highlight; the replier never does.
- `@` autocomplete works; mentions render as pills; "mentions me" highlighting is correct per-viewer.
- Any member can pin/unpin; the pinned panel + header count are correct and update live.
- New unit tests pass; the backend smoke test passes; the manual checklist passes.

When complete, remaining rich-messaging features are threads, link previews, non-image files, and the full emoji picker — each its own slice.
