# Inter Font + Profile Pictures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch the UI font to Inter (self-hosted) and add profile pictures — avatar display in messages and the sidebar, an anonymous-person default, and upload via a profile dialog stored in a dedicated `avatars` Storage bucket.

**Architecture:** Inter is loaded with `next/font/google` and wired into the existing `--font-sans` token. A single reusable `Avatar` component renders an uploaded image or a default silhouette. `profiles.avatar_url` (already in the schema) is read everywhere identity shows and written via an `uploadAvatar` helper + `ProfileDialog`; `AuthProvider` gains `refreshProfile()` so the uploader sees changes immediately.

**Tech Stack:** Next.js 16 (`next/font`), Tailwind v4, Supabase (Storage + Postgres), TypeScript, Vitest.

---

## Prerequisites

- [ ] **P1: Node on PATH** — `node --version` (v20+). If missing: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"`.
- [ ] **P2: Supabase project active** — open the dashboard; if paused, Resume.

## File Structure

```
website/
  supabase/migrations/0004_avatars_bucket.sql   # NEW: avatars Storage bucket + policies (run manually)
  src/
    app/layout.tsx                              # MODIFY: load Inter, apply its variable
    app/globals.css                             # MODIFY: --font-sans uses Inter var
    lib/upload.ts                               # MODIFY: add uploadAvatar()
    components/
      Avatar.tsx                                # NEW: image-or-silhouette circle
      ProfileDialog.tsx                         # NEW: view/upload your avatar
      providers/AuthProvider.tsx                # MODIFY: add refreshProfile()
      Sidebar.tsx                               # MODIFY: avatars in DM list + user panel; open ProfileDialog
      NewDmDialog.tsx                           # MODIFY: avatar in search results
      MessageList.tsx                           # MODIFY: fetch profiles (with avatar_url), pass down
      MessageItem.tsx                           # MODIFY: avatar column + alignment gutter
```

---

## Task 1: Load Inter

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Replace the entire contents of `src/app/layout.tsx`** with:

```tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/providers/AuthProvider";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = { title: "Chat", description: "Group chat" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-app text-ink antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Update `--font-sans` in `src/app/globals.css`.** Change the line:
```css
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
```
to:
```css
  --font-sans: var(--font-inter), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
```
(Leave everything else in the file unchanged; `body` already uses `var(--font-sans)`.)

- [ ] **Step 3: Verify build** — `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/mallow/projects/website && npm run build`. Expected: success; `next/font` fetches and self-hosts Inter at build time. If the build environment has no network and `next/font/google` fails to fetch, report BLOCKED (do not switch to a runtime `<link>` without reporting). Do NOT leave a dev server running.

- [ ] **Step 4: Commit**
```bash
git add src/app/layout.tsx src/app/globals.css
git commit -m "feat: use Inter as the app font (self-hosted via next/font)"
```

---

## Task 2: Create the avatars Storage bucket

**Files:**
- Create: `supabase/migrations/0004_avatars_bucket.sql`

- [ ] **Step 1: Write `supabase/migrations/0004_avatars_bucket.sql`**

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152,
        array['image/png','image/jpeg','image/gif','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "authenticated upload avatars" on storage.objects;
create policy "authenticated upload avatars"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars');

drop policy if exists "public read avatars" on storage.objects;
create policy "public read avatars"
  on storage.objects for select to public
  using (bucket_id = 'avatars');
```

- [ ] **Step 2: Run it in Supabase** — SQL Editor → New query → paste → Run. Expected: "Success. No rows returned." Verify under Storage that an `avatars` bucket exists and is public.

- [ ] **Step 3: Commit**
```bash
git add supabase/migrations/0004_avatars_bucket.sql
git commit -m "feat: add avatars Storage bucket migration"
```

---

## Task 3: Avatar component, uploadAvatar, and refreshProfile

**Files:**
- Create: `src/components/Avatar.tsx`
- Modify: `src/lib/upload.ts`
- Modify: `src/components/providers/AuthProvider.tsx`

- [ ] **Step 1: Create `src/components/Avatar.tsx`**

```tsx
"use client";

import { useState } from "react";

const SIZES = { sm: "w-6 h-6", md: "w-10 h-10", lg: "w-[72px] h-[72px]" } as const;

export function Avatar({
  url,
  name,
  size = "md",
}: {
  url: string | null;
  name?: string;
  size?: keyof typeof SIZES;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = !!url && !failed;
  return (
    <div
      className={`${SIZES[size]} rounded-full bg-surface flex items-center justify-center overflow-hidden flex-none text-muted`}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url!}
          alt={name ?? "avatar"}
          className="w-full h-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <svg viewBox="0 0 24 24" className="w-3/5 h-3/5" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-4.4 0-8 2.7-8 6v1h16v-1c0-3.3-3.6-6-8-6z"
          />
        </svg>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add `uploadAvatar` to `src/lib/upload.ts`.** Append this function (keep `validateImage` and `uploadImage` exactly as they are):

```ts
export async function uploadAvatar(file: File): Promise<{ url: string } | { error: string }> {
  const check = validateImage(file);
  if (!check.ok) return { error: check.error };
  const supabase = createClient();
  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from("avatars")
    .upload(path, file, { contentType: file.type });
  if (error) return { error: `Upload failed: ${error.message}` };
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return { url: data.publicUrl };
}
```
Note: `validateImage` allows up to 5 MB (shared with message images); the `avatars` bucket enforces the 2 MB cap server-side and its error surfaces via the message above. This is intentional — do not change the shared `validateImage`.

- [ ] **Step 3: Replace the entire contents of `src/components/providers/AuthProvider.tsx`** with (adds `refreshProfile`):

```tsx
"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/types/db";

type AuthState = {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};
const AuthContext = createContext<AuthState>({
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
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

  const refreshProfile = useCallback(async () => {
    if (!user) {
      setProfile(null);
      return;
    }
    const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
    setProfile((data as Profile) ?? null);
  }, [supabase, user]);

  useEffect(() => {
    refreshProfile();
  }, [refreshProfile]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
```

- [ ] **Step 4: Verify build + tests** — `npm run build` then `npm test`. Expected: build success; 32 tests pass (validateImage tests still cover the upload validation).

- [ ] **Step 5: Commit**
```bash
git add src/components/Avatar.tsx src/lib/upload.ts src/components/providers/AuthProvider.tsx
git commit -m "feat: add Avatar component, uploadAvatar helper, and refreshProfile"
```

---

## Task 4: Profile dialog + sidebar/new-DM avatars

**Files:**
- Create: `src/components/ProfileDialog.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/NewDmDialog.tsx`

- [ ] **Step 1: Create `src/components/ProfileDialog.tsx`**

```tsx
"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { uploadAvatar } from "@/lib/upload";
import { Avatar } from "@/components/Avatar";

export function ProfileDialog({ onClose }: { onClose: () => void }) {
  const supabase = createClient();
  const { user, profile, refreshProfile } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;
    setError(null);
    setBusy(true);
    const res = await uploadAvatar(file);
    if ("error" in res) {
      setBusy(false);
      setError(res.error);
      return;
    }
    const { error: upErr } = await supabase
      .from("profiles")
      .update({ avatar_url: res.url })
      .eq("id", user.id);
    setBusy(false);
    if (upErr) {
      setError("Couldn't save — try again");
      return;
    }
    await refreshProfile();
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-surface p-5 rounded-xl w-72 border border-line text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-ink font-semibold mb-3">Your profile</h2>
        <div className="flex justify-center mb-3">
          <Avatar url={profile?.avatar_url ?? null} name={profile?.display_name} size="lg" />
        </div>
        <div className="text-ink font-medium">{profile?.display_name ?? user?.email}</div>
        {error && <p className="text-danger text-sm mt-2">{error}</p>}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="mt-4 w-full bg-accent hover:bg-accent-strong text-white font-medium rounded-lg p-2 disabled:opacity-50"
        >
          {busy ? "Uploading…" : "Upload image"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace the entire contents of `src/components/Sidebar.tsx`** with (adds DM-list avatars + a clickable user-panel avatar that opens `ProfileDialog`; uses `profile` from `useAuth`):

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import type { Channel, Profile } from "@/types/db";
import { NewDmDialog } from "@/components/NewDmDialog";
import { Avatar } from "@/components/Avatar";
import { ProfileDialog } from "@/components/ProfileDialog";

export function Sidebar() {
  const supabase = createClient();
  const router = useRouter();
  const { user, profile, signOut } = useAuth();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [dms, setDms] = useState<{ id: string; other: Profile }[]>([]);
  const [showProfile, setShowProfile] = useState(false);

  useEffect(() => {
    supabase.from("channels").select("*").order("position")
      .then(({ data }) => setChannels(data ?? []));
  }, [supabase]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: memberships } = await supabase
        .from("conversation_members")
        .select("conversation_id")
        .eq("user_id", user.id);
      const convIds = (memberships ?? []).map((m) => m.conversation_id);
      if (convIds.length === 0) return setDms([]);
      const { data: others } = await supabase
        .from("conversation_members")
        .select("conversation_id, profiles(*)")
        .in("conversation_id", convIds)
        .neq("user_id", user.id);
      setDms(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (others ?? []).map((o: any) => ({ id: o.conversation_id, other: o.profiles }))
      );
    })();
  }, [supabase, user]);

  async function onSignOut() {
    await signOut();
    router.replace("/login");
  }

  return (
    <aside className="w-60 bg-sidebar flex flex-col">
      <div className="p-3 font-bold text-ink border-b border-line">🏫 Our Server</div>
      <nav className="flex-1 overflow-y-auto p-2 text-muted">
        <div className="text-xs uppercase mt-2 mb-1">Text Channels</div>
        {channels.map((c) => (
          <Link key={c.id} href={`/channels/${c.name}`}
            className="block px-2 py-1 rounded hover:bg-surface hover:text-ink">
            # {c.name}
          </Link>
        ))}
        <div className="flex items-center justify-between text-xs uppercase mt-4 mb-1">
          Direct Messages <NewDmDialog />
        </div>
        {dms.map((d) => (
          <Link key={d.id} href={`/dms/${d.id}`}
            className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface hover:text-ink">
            <Avatar url={d.other?.avatar_url ?? null} name={d.other?.display_name} size="sm" />
            {d.other?.display_name ?? "Unknown"}
          </Link>
        ))}
      </nav>
      <div className="p-2 bg-surface-2 rounded-xl flex items-center justify-between text-sm gap-2">
        <button
          onClick={() => setShowProfile(true)}
          className="flex items-center gap-2 min-w-0 hover:opacity-80"
          title="Edit profile"
        >
          <Avatar url={profile?.avatar_url ?? null} name={profile?.display_name} size="sm" />
          <span className="text-ink truncate">{profile?.display_name ?? user?.email}</span>
        </button>
        <button onClick={onSignOut} className="text-muted hover:text-ink flex-none">Log out</button>
      </div>
      {showProfile && <ProfileDialog onClose={() => setShowProfile(false)} />}
    </aside>
  );
}
```

- [ ] **Step 3: Add an avatar to each result in `src/components/NewDmDialog.tsx`.** Add the import after the existing imports:
```tsx
import { Avatar } from "@/components/Avatar";
```
Then change the result button's content. The current button is:
```tsx
                  <button onClick={() => startDm(p)}
                    className="w-full text-left px-2 py-1 rounded hover:bg-surface text-ink">
                    {p.display_name} <span className="text-muted">@{p.username}</span>
                  </button>
```
Replace it with:
```tsx
                  <button onClick={() => startDm(p)}
                    className="w-full text-left px-2 py-1 rounded hover:bg-surface text-ink flex items-center gap-2">
                    <Avatar url={p.avatar_url ?? null} name={p.display_name} size="sm" />
                    <span className="truncate">{p.display_name} <span className="text-muted">@{p.username}</span></span>
                  </button>
```
Do not change the search or startDm logic.

- [ ] **Step 4: Verify build** — `npm run build`. Expected: success.

- [ ] **Step 5: Commit**
```bash
git add src/components/ProfileDialog.tsx src/components/Sidebar.tsx src/components/NewDmDialog.tsx
git commit -m "feat: profile dialog + sidebar/new-DM avatars"
```

---

## Task 5: Avatars in messages

**Files:**
- Modify: `src/components/MessageList.tsx`
- Modify: `src/components/MessageItem.tsx`

- [ ] **Step 1: Replace the entire contents of `src/components/MessageList.tsx`** with (stores a full profiles map so avatar_url is available; passes `authorAvatar` to each item):

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
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const bottom = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const reactionsByMessage = useReactions(messages.map((m) => m.id), user?.id ?? "");
  const byId = new Map(messages.map((m) => [m.id, m]));

  useEffect(() => {
    const missing = [...new Set(messages.map((m) => m.author_id))].filter((id) => !profiles[id]);
    if (missing.length === 0) return;
    supabase.from("profiles").select("*").in("id", missing).then(({ data }) => {
      const next: Record<string, Profile> = {};
      (data as Profile[] | null)?.forEach((p) => (next[p.id] = p));
      setProfiles((prev) => ({ ...prev, ...next }));
    });
  }, [messages, profiles, supabase]);

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
            authorName={profiles[m.author_id]?.display_name ?? "…"}
            authorAvatar={profiles[m.author_id]?.avatar_url ?? null}
            showHeader={showHeader}
            pills={reactionsByMessage[m.id] ?? []}
            repliedTo={repliedTo}
            repliedToName={repliedTo ? profiles[repliedTo.author_id]?.display_name : undefined}
            onReply={onReply}
          />
        );
      })}
      <div ref={bottom} />
    </div>
  );
}
```

- [ ] **Step 2: Replace the entire contents of `src/components/MessageItem.tsx`** with (adds an avatar column on group-header rows and a matching left gutter so stacked messages align; everything else — edit/delete/pin/reply/reactions/highlight — preserved):

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
import { Avatar } from "@/components/Avatar";
import type { ReactionPill } from "@/lib/reactions";

function snippet(m: Message): string {
  if (m.content) return m.content.length > 60 ? m.content.slice(0, 60) + "…" : m.content;
  if (m.image_url) return "📷 image";
  return "";
}

export function MessageItem({
  msg,
  authorName,
  authorAvatar,
  showHeader,
  pills,
  repliedTo,
  repliedToName,
  onReply,
}: {
  msg: Message;
  authorName: string;
  authorAvatar: string | null;
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

  const highlighted = mentionsMe({
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
    else setError(null);
  }

  function jumpToOriginal() {
    if (repliedTo) document.getElementById(`msg-${repliedTo.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div
      id={`msg-${msg.id}`}
      className={`group relative px-4 hover:bg-black/10 ${showHeader ? "mt-3 pt-0.5" : ""} ${
        highlighted ? "bg-amber/10 border-l-2 border-amber" : ""
      }`}
    >
      {!showHeader && msg.pinned && (
        <span className="absolute left-1 top-0.5 text-[10px] text-muted" title="Pinned">📌</span>
      )}
      <div className="flex gap-3">
        {/* left column: avatar on header rows, empty gutter otherwise (keeps alignment) */}
        <div className="w-10 flex-none">
          {showHeader && <Avatar url={authorAvatar} name={authorName} size="md" />}
        </div>
        <div className="flex-1 min-w-0">
          {msg.reply_to_id && (
            <div
              onClick={jumpToOriginal}
              className="flex items-center gap-1 text-[11px] text-muted mb-0.5 cursor-pointer"
            >
              <span className="text-muted">↰</span>
              {repliedTo ? (
                <>
                  {msg.mention_author ? (
                    <span className="bg-mention text-mention-ink rounded px-1 font-medium">@{repliedToName ?? "user"}</span>
                  ) : (
                    <span className="text-ink font-semibold">{repliedToName ?? "user"}</span>
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
              <span className="font-semibold text-ink">{authorName}</span>
              <span className="text-xs text-muted ml-2">{formatTime(msg.created_at)}</span>
              {msg.pinned && <span className="text-xs text-muted ml-2" title="Pinned">📌</span>}
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
                className="w-full p-2 rounded-lg bg-surface text-ink outline-none"
              />
              {error && <p className="text-danger text-sm">{error}</p>}
              <p className="text-xs text-muted">Enter to save · Esc to cancel</p>
            </div>
          ) : (
            <MessageContent msg={msg} />
          )}
          {error && !editing && <p className="text-danger text-sm">{error}</p>}

          {!editing && <ReactionBar message={msg} pills={pills} />}
        </div>
      </div>
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

- [ ] **Step 3: Verify build + tests** — `npm run build` then `npm test`. Expected: build success; 32 tests pass.

- [ ] **Step 4: Commit**
```bash
git add src/components/MessageList.tsx src/components/MessageItem.tsx
git commit -m "feat: show author avatars in messages with aligned grouping"
```

---

## Task 6: Final verification + merge

**Files:** none (verification)

- [ ] **Step 1: Full build + tests** — `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/mallow/projects/website && npm run build && npm test`. Expected: build clean; 32 tests pass.

- [ ] **Step 2: Backend smoke test of the avatars bucket + profile update.** Create `smoke-avatar.cjs`:
```js
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.SB_URL, process.env.SB_KEY);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
(async () => {
  const s = Date.now();
  const { data: up } = await sb.auth.signUp({ email: `av.${s}@gmail.com`, password: "TestPass123!" });
  if (!up.session) return console.log(">> no session");
  const uid = up.user.id;
  await sb.from("profiles").insert({ id: uid, username: "av" + (s % 100000), display_name: "Av" });
  const path = `${s}.png`;
  const { error: upErr } = await sb.storage.from("avatars").upload(path, PNG, { contentType: "image/png" });
  console.log("avatar upload:", upErr ? "ERR " + upErr.message : "OK");
  const { data: pub } = sb.storage.from("avatars").getPublicUrl(path);
  const { error: pErr } = await sb.from("profiles").update({ avatar_url: pub.publicUrl }).eq("id", uid);
  console.log("profile update:", pErr ? "ERR " + pErr.message : "OK");
  const res = await fetch(pub.publicUrl);
  console.log("public read:", res.status, res.headers.get("content-type"));
  console.log("SMOKE_DONE");
})();
```
Run:
```bash
set -a; . ./.env.local; set +a
SB_URL="$NEXT_PUBLIC_SUPABASE_URL" SB_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" node smoke-avatar.cjs
rm -f smoke-avatar.cjs
```
Expected: `avatar upload: OK`, `profile update: OK`, `public read: 200 image/png`, `SMOKE_DONE`. If `avatar upload` errors with "Bucket not found", Task 2's SQL wasn't run — run it first.

- [ ] **Step 3: Manual visual pass** (`npm run dev`, http://localhost:3000, two browsers):
  - App text renders in Inter.
  - A fresh user with no avatar shows the anonymous silhouette in messages, the DM list, and the user panel.
  - Click your user-panel avatar → ProfileDialog opens → Upload an image → your avatar updates in place (panel + your messages).
  - The other browser sees your new avatar after reload.
  - Message avatars appear on the first message of each group; stacked messages align under the avatar column; reply previews/reactions sit in the content column.
  - A >2 MB image is rejected with an inline error; everything else (edit/delete/react/reply/pin/image) still works.
  - Stop the dev server when done.

- [ ] **Step 4: Merge to main.**
```bash
git checkout main
git merge feat/font-and-avatars
git branch -d feat/font-and-avatars
```

- [ ] **Step 5: Done.** Inter font + profile pictures shipped.

---

## Done Criteria

- App renders in Inter.
- Avatars show in messages + sidebar; users without one get the anonymous silhouette; uploading via the profile dialog updates immediately and persists.
- The `avatars` bucket exists; the backend smoke test passes.
- `npm run build` and `npm test` pass; the manual visual checklist passes; merged to `main`.
