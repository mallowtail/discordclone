# Roles & Permissions + Optimistic Send Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tiered role model (owner/admin/member) that gates server management to admins, a members panel with role controls, deletion of the legacy "Our Server", and optimistic (gray→opaque) message sending.

**Architecture:** A `server_members.role` column + an `is_server_admin` SQL helper drive membership-based RLS for channel/category/server/role management; the UI reads roles via a `useServerRole` hook and gates controls. Optimistic send: the client generates the message id, shows a `pending` message immediately, and the realtime echo replaces it (clearing pending).

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (Postgres + RLS + Realtime), Tailwind v4, Vitest.

## Global Constraints

- Node via nvm, NOT on PATH: prefix node/npm commands with `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"`.
- Branch: `feat/roles-optimistic` — never switch branches.
- Migration `0007` is run MANUALLY by the human in the Supabase SQL editor; subagents only write the `.sql` file.
- Theme tokens only: `bg-app bg-sidebar bg-surface bg-surface-2 border-line text-ink text-muted text-accent bg-accent hover:bg-accent-strong bg-mention text-mention-ink text-danger` (opacity modifiers OK).
- Must not break the existing 39 unit tests.

---

## File Structure

```
supabase/migrations/0007_roles.sql        # NEW: role column, is_server_admin, admin-gated RLS, delete legacy server
src/
  types/db.ts                             # MODIFY: ServerMember.role; Message.pending?
  lib/roles.ts                            # NEW: canManageRole() (pure, tested)
  hooks/
    useMessages.ts                        # MODIFY: return {messages, addPending, removePending}; INSERT replaces-by-id
    useServerRole.ts                      # NEW: {role, isOwner, isManager, loading}
  components/
    MessageInput.tsx                      # MODIFY: optimistic add + insert with client id
    MessageItem.tsx                       # MODIFY: dim when pending
    MembersPanel.tsx                      # NEW: member list + role badges + promote/demote
    ServerSidebar.tsx                     # MODIFY: gate + Channel/+ Category to managers
    ServerSettingsDialog.tsx              # MODIFY: gate rename/icon to managers (Leave stays for all)
  app/(app)/channels/[channelId]/page.tsx # MODIFY: {messages,...} destructure; 👥 Members toggle
  app/(app)/dms/[conversationId]/page.tsx # MODIFY: {messages,...} destructure
  app/register/page.tsx                   # MODIFY: remove auto-join-oldest-server
tests/roles.test.ts                       # NEW
```

---

## Task 1: Migration 0007 + types

**Files:**
- Create: `supabase/migrations/0007_roles.sql`
- Modify: `src/types/db.ts`

**Interfaces:**
- Produces (SQL): `server_members.role`; `is_server_admin(srv uuid) -> boolean`; admin-gated write policies; legacy server deleted.
- Produces (types): `ServerMember.role: "admin" | "member"`; `Message.pending?: boolean`.

- [ ] **Step 1: Write `supabase/migrations/0007_roles.sql`**

```sql
-- role column
alter table public.server_members
  add column if not exists role text not null default 'member' check (role in ('admin','member'));

-- owner OR admin
create or replace function public.is_server_admin(srv uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from public.servers s where s.id = srv and s.owner_id = auth.uid())
      or exists (select 1 from public.server_members m
                 where m.server_id = srv and m.user_id = auth.uid() and m.role = 'admin');
$$;

-- tighten self-join: a joining user cannot self-assign admin
drop policy if exists "self join server" on public.server_members;
create policy "self join server" on public.server_members for insert to authenticated
  with check (user_id = auth.uid() and role = 'member');

-- role management: owner + admins may update roles
drop policy if exists "manage member roles" on public.server_members;
create policy "manage member roles" on public.server_members for update to authenticated
  using (public.is_server_admin(server_id)) with check (public.is_server_admin(server_id));

-- channels: management gated to admins (replaces the member-level policies from 0005)
drop policy if exists "members insert channels" on public.channels;
drop policy if exists "members update channels" on public.channels;
drop policy if exists "members delete channels" on public.channels;
create policy "admins insert channels" on public.channels for insert to authenticated with check (public.is_server_admin(server_id));
create policy "admins update channels" on public.channels for update to authenticated using (public.is_server_admin(server_id));
create policy "admins delete channels" on public.channels for delete to authenticated using (public.is_server_admin(server_id));

-- categories: management gated to admins
drop policy if exists "members insert categories" on public.categories;
drop policy if exists "members update categories" on public.categories;
drop policy if exists "members delete categories" on public.categories;
create policy "admins insert categories" on public.categories for insert to authenticated with check (public.is_server_admin(server_id));
create policy "admins update categories" on public.categories for update to authenticated using (public.is_server_admin(server_id));
create policy "admins delete categories" on public.categories for delete to authenticated using (public.is_server_admin(server_id));

-- server rename/icon gated to admins
drop policy if exists "members update server" on public.servers;
create policy "admins update server" on public.servers for update to authenticated using (public.is_server_admin(id));

-- delete the legacy ownerless "Our Server" (cascades channels/messages/categories/memberships)
delete from public.servers where owner_id is null;
```

- [ ] **Step 2: Run it in Supabase** (SQL Editor → Run). Expected: "Success." Verify `server_members` has a `role` column and `servers` no longer contains the ownerless row.

- [ ] **Step 3: Update `src/types/db.ts`** — add `role` to `ServerMember` and `pending` to `Message`. Change `ServerMember` to:
```ts
export type ServerMember = {
  server_id: string;
  user_id: string;
  joined_at: string;
  role: "admin" | "member";
};
```
and add `pending?: boolean;` as the last field of the `Message` type (it's a client-only optimistic flag; DB reads leave it undefined). Keep all other types unchanged.

- [ ] **Step 4: Verify build** — `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/mallow/projects/website && npm run build`. Expected: success.

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/0007_roles.sql src/types/db.ts
git commit -m "feat: roles schema, admin-gated RLS, delete legacy server"
```

---

## Task 2: Optimistic message send

**Files:**
- Modify: `src/hooks/useMessages.ts`
- Modify: `src/components/MessageInput.tsx`
- Modify: `src/components/MessageItem.tsx`
- Modify: `src/app/(app)/channels/[channelId]/page.tsx`
- Modify: `src/app/(app)/dms/[conversationId]/page.tsx`

**Interfaces:**
- Produces: `useMessages(target)` now returns `{ messages: Message[]; addPending: (m: Message) => void; removePending: (id: string) => void }`.
- Consumes: `MessageInput` gains props `addPending: (m: Message) => void`, `removePending: (id: string) => void`.

- [ ] **Step 1: Replace the entire contents of `src/hooks/useMessages.ts`** with (adds pending helpers; INSERT now replaces-by-id so the real row clears `pending`):

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Message } from "@/types/db";

type Target = { channelId: string } | { conversationId: string };

export function useMessages(target: Target) {
  const supabase = createClient();
  const [messages, setMessages] = useState<Message[]>([]);
  const column = "channelId" in target ? "channel_id" : "conversation_id";
  const value = "channelId" in target ? target.channelId : target.conversationId;

  const addPending = useCallback((m: Message) => {
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
  }, []);
  const removePending = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  useEffect(() => {
    let active = true;

    async function load() {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq(column, value)
        .order("created_at", { ascending: true })
        .limit(200);
      if (active) setMessages(data ?? []);
    }
    load();

    const channel = supabase
      .channel(`messages:${column}:${value}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `${column}=eq.${value}` },
        (payload) =>
          setMessages((prev) => {
            const row = payload.new as Message;
            // replace an existing id (clears an optimistic `pending` row) or append
            return prev.some((m) => m.id === row.id)
              ? prev.map((m) => (m.id === row.id ? row : m))
              : [...prev, row];
          })
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
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "messages" },
        (payload) =>
          setMessages((prev) => prev.filter((m) => m.id !== (payload.old as { id: string }).id))
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") load();
      });

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [supabase, column, value]);

  return { messages, addPending, removePending };
}
```

- [ ] **Step 2: Update the two page call sites.** In `src/app/(app)/channels/[channelId]/page.tsx`, inside `ChannelView`, change:
```tsx
  const messages = useMessages({ channelId: channel.id });
```
to:
```tsx
  const { messages, addPending, removePending } = useMessages({ channelId: channel.id });
```
and add `addPending={addPending} removePending={removePending}` to the `<MessageInput .../>` props.

In `src/app/(app)/dms/[conversationId]/page.tsx`, change:
```tsx
  const messages = useMessages({ conversationId });
```
to:
```tsx
  const { messages, addPending, removePending } = useMessages({ conversationId });
```
and add `addPending={addPending} removePending={removePending}` to its `<MessageInput .../>` props.

- [ ] **Step 3: Update `src/components/MessageInput.tsx`.** Add the two props to the type and destructure:
Change the prop type block to include:
```tsx
  addPending,
  removePending,
}: {
  target: Target;
  placeholder: string;
  replyTo?: Message | null;
  replyToName?: string;
  onClearReply?: () => void;
  addPending: (m: Message) => void;
  removePending: (id: string) => void;
}) {
```
Replace the `submit()` function with:
```tsx
  async function submit() {
    if (uploading) return;
    const v = validateMessage(text);
    if (!v.ok) return setError(v.error);
    setError(null);
    const draft = v.value;
    setText("");
    const id = crypto.randomUUID();
    const optimistic: Message = {
      id,
      author_id: user!.id,
      channel_id: "channel_id" in target ? target.channel_id : null,
      conversation_id: "conversation_id" in target ? target.conversation_id : null,
      content: draft,
      image_url: null,
      created_at: new Date().toISOString(),
      updated_at: null,
      reply_to_id: replyTo?.id ?? null,
      mention_author: replyTo ? pingAuthor : false,
      pinned: false,
      pinned_at: null,
      pending: true,
    };
    addPending(optimistic);
    const { error: err } = await supabase
      .from("messages")
      .insert({ id, author_id: user!.id, content: draft, ...replyFields(), ...target });
    if (err) {
      removePending(id);
      setText(draft);
      setError("Failed to send — try again");
      return;
    }
    onClearReply?.();
  }
```
Replace the `onPickFile()` function's insert section (from `const content = text.trim();` to the end of the function) with:
```tsx
    const content = text.trim();
    setText("");
    const id = crypto.randomUUID();
    const optimistic: Message = {
      id,
      author_id: user!.id,
      channel_id: "channel_id" in target ? target.channel_id : null,
      conversation_id: "conversation_id" in target ? target.conversation_id : null,
      content,
      image_url: result.url,
      created_at: new Date().toISOString(),
      updated_at: null,
      reply_to_id: replyTo?.id ?? null,
      mention_author: replyTo ? pingAuthor : false,
      pinned: false,
      pinned_at: null,
      pending: true,
    };
    addPending(optimistic);
    const { error: err } = await supabase
      .from("messages")
      .insert({ id, author_id: user!.id, content, image_url: result.url, ...replyFields(), ...target });
    if (err) {
      removePending(id);
      setError("Failed to send image — try again");
      return;
    }
    onClearReply?.();
  }
```

- [ ] **Step 4: Update `src/components/MessageItem.tsx`** to dim pending messages. Find the outer wrapper div's className (it starts `group relative px-4 hover:bg-black/10 ...`) and append `${msg.pending ? "opacity-50" : ""}` to that template string. For example the opening changes from:
```tsx
      className={`group relative px-4 hover:bg-black/10 ${showHeader ? "mt-3 pt-0.5" : ""} ${
        highlighted ? "bg-amber/10 border-l-2 border-amber" : ""
      }`}
```
to:
```tsx
      className={`group relative px-4 hover:bg-black/10 ${showHeader ? "mt-3 pt-0.5" : ""} ${
        highlighted ? "bg-amber/10 border-l-2 border-amber" : ""
      } ${msg.pending ? "opacity-50" : ""}`}
```

- [ ] **Step 5: Verify build + tests** — `npm run build && npm test`. Expected: build clean; 39 tests pass.

- [ ] **Step 6: Commit**
```bash
git add src/hooks/useMessages.ts src/components/MessageInput.tsx src/components/MessageItem.tsx "src/app/(app)/channels/[channelId]/page.tsx" "src/app/(app)/dms/[conversationId]/page.tsx"
git commit -m "feat: optimistic message send (gray while pending, opaque on confirm)"
```

---

## Task 3: Role helper (TDD), useServerRole, MembersPanel, header toggle

**Files:**
- Create: `src/lib/roles.ts`
- Test: `tests/roles.test.ts`
- Create: `src/hooks/useServerRole.ts`
- Create: `src/components/MembersPanel.tsx`
- Modify: `src/app/(app)/channels/[channelId]/page.tsx`

**Interfaces:**
- Produces: `canManageRole(actor: { isOwner: boolean; role: "admin" | "member" }): boolean`; `useServerRole(serverId: string | null): { role: "admin"|"member"; isOwner: boolean; isManager: boolean; loading: boolean }`; `<MembersPanel serverId={string} onClose={() => void} />`.

- [ ] **Step 1: Write the failing test `tests/roles.test.ts`**
```ts
import { describe, it, expect } from "vitest";
import { canManageRole } from "@/lib/roles";

describe("canManageRole", () => {
  it("owner can manage", () => {
    expect(canManageRole({ isOwner: true, role: "member" })).toBe(true);
  });
  it("admin can manage", () => {
    expect(canManageRole({ isOwner: false, role: "admin" })).toBe(true);
  });
  it("plain member cannot manage", () => {
    expect(canManageRole({ isOwner: false, role: "member" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL** — `npm test` (missing module).

- [ ] **Step 3: Implement `src/lib/roles.ts`**
```ts
export function canManageRole(actor: { isOwner: boolean; role: "admin" | "member" }): boolean {
  return actor.isOwner || actor.role === "admin";
}
```

- [ ] **Step 4: Run, confirm PASS** — `npm test` (3 new + existing pass).

- [ ] **Step 5: Create `src/hooks/useServerRole.ts`**
```ts
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { canManageRole } from "@/lib/roles";

export function useServerRole(serverId: string | null): {
  role: "admin" | "member";
  isOwner: boolean;
  isManager: boolean;
  loading: boolean;
} {
  const supabase = createClient();
  const { user } = useAuth();
  const [role, setRole] = useState<"admin" | "member">("member");
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!serverId || !user) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    (async () => {
      const [{ data: s }, { data: m }] = await Promise.all([
        supabase.from("servers").select("owner_id").eq("id", serverId).single(),
        supabase.from("server_members").select("role").eq("server_id", serverId).eq("user_id", user.id).maybeSingle(),
      ]);
      if (!active) return;
      setIsOwner((s?.owner_id ?? null) === user.id);
      setRole(((m?.role as "admin" | "member") ?? "member"));
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [supabase, serverId, user]);

  return { role, isOwner, isManager: canManageRole({ isOwner, role }), loading };
}
```

- [ ] **Step 6: Create `src/components/MembersPanel.tsx`**
```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/types/db";
import { Avatar } from "@/components/Avatar";
import { useServerRole } from "@/hooks/useServerRole";

type Member = { user_id: string; role: "admin" | "member"; profile: Profile | null };

export function MembersPanel({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const supabase = createClient();
  const { isManager } = useServerRole(serverId);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);

  const load = useCallback(async () => {
    const [{ data: s }, { data: rows }] = await Promise.all([
      supabase.from("servers").select("owner_id").eq("id", serverId).single(),
      supabase.from("server_members").select("user_id, role, profiles(*)").eq("server_id", serverId),
    ]);
    setOwnerId((s?.owner_id as string) ?? null);
    setMembers(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rows ?? []).map((r: any) => ({ user_id: r.user_id, role: r.role, profile: r.profiles }))
    );
  }, [supabase, serverId]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`members:${serverId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "server_members", filter: `server_id=eq.${serverId}` }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, serverId, load]);

  async function setRole(userId: string, role: "admin" | "member") {
    await supabase.from("server_members").update({ role }).eq("server_id", serverId).eq("user_id", userId);
  }

  function badge(m: Member) {
    if (m.user_id === ownerId) return <span className="text-accent text-[10px] font-semibold">OWNER</span>;
    if (m.role === "admin") return <span className="text-muted text-[10px] font-semibold bg-surface-2 rounded px-1">ADMIN</span>;
    return <span className="text-muted text-[10px]">member</span>;
  }

  return (
    <aside className="w-56 bg-sidebar border-l border-line flex flex-col">
      <div className="p-3 font-bold text-ink border-b border-line flex items-center justify-between">
        <span>Members</span>
        <button onClick={onClose} className="text-muted hover:text-ink text-sm">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
        {members.map((m) => (
          <div key={m.user_id} className="flex items-center gap-2 p-1.5 rounded hover:bg-surface">
            <Avatar url={m.profile?.avatar_url ?? null} name={m.profile?.display_name} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="text-ink text-sm truncate">{m.profile?.display_name ?? "Unknown"}</div>
              {badge(m)}
            </div>
            {isManager && m.user_id !== ownerId && (
              m.role === "admin" ? (
                <button onClick={() => setRole(m.user_id, "member")}
                  className="text-[10px] text-muted hover:text-ink">Remove admin</button>
              ) : (
                <button onClick={() => setRole(m.user_id, "admin")}
                  className="text-[10px] text-accent hover:underline">Make admin</button>
              )
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
```

- [ ] **Step 7: Add the 👥 Members toggle to `src/app/(app)/channels/[channelId]/page.tsx`.** Add the import after the existing imports:
```tsx
import { MembersPanel } from "@/components/MembersPanel";
```
In `ChannelView`, add state next to `showPins`:
```tsx
  const [showMembers, setShowMembers] = useState(false);
```
Add a Members button in the header right group, immediately after the Pinned button (inside the same `<header>`, before the `{showPins && ...}` line):
```tsx
        <button
          onClick={() => setShowMembers((s) => !s)}
          className="text-xs font-normal text-muted hover:text-ink ml-3"
        >
          👥 Members
        </button>
```
Then wrap the message area so the panel sits on the right. Change the `ChannelView` return so the `<MessageList/>` + `<MessageInput/>` are in a flex row with the panel. Specifically, replace the fragment structure: keep the `<header>` as-is, then wrap the rest:
```tsx
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 flex flex-col min-w-0">
          <MessageList messages={messages} onReply={(m, name) => { setReplyTo(m); setReplyToName(name); }} />
          <MessageInput
            target={{ channel_id: channel.id }}
            placeholder={`Message #${channel.name}`}
            replyTo={replyTo}
            replyToName={replyToName}
            onClearReply={() => setReplyTo(null)}
            addPending={addPending}
            removePending={removePending}
          />
        </div>
        {showMembers && <MembersPanel serverId={channel.server_id} onClose={() => setShowMembers(false)} />}
      </div>
```
(The outer element must be a fragment `<>...</>` containing the `<header>` then this `<div>`. Ensure `addPending`/`removePending` come from the Task 2 destructure.)

- [ ] **Step 8: Verify build + tests** — `npm run build && npm test`. Expected: build clean; 42 tests pass (39 + 3).

- [ ] **Step 9: Commit**
```bash
git add src/lib/roles.ts tests/roles.test.ts src/hooks/useServerRole.ts src/components/MembersPanel.tsx "src/app/(app)/channels/[channelId]/page.tsx"
git commit -m "feat: roles helper, useServerRole, members panel with promote/demote"
```

---

## Task 4: Gate management UI to managers

**Files:**
- Modify: `src/components/ServerSidebar.tsx`
- Modify: `src/components/ServerSettingsDialog.tsx`
- Modify: `src/app/register/page.tsx`

**Interfaces:**
- Consumes: `useServerRole` (isManager); `ServerSettingsDialog` gains an `isManager: boolean` prop.

- [ ] **Step 1: Gate the sidebar create buttons in `src/components/ServerSidebar.tsx`.** Add the import after the existing imports:
```tsx
import { useServerRole } from "@/hooks/useServerRole";
```
Inside `ServerSidebar`, after the existing state declarations, add:
```tsx
  const { isManager } = useServerRole(serverId);
```
Wrap the create-buttons row so it only renders for managers. Change:
```tsx
        <div className="flex gap-2 mt-3 text-xs">
          <button onClick={() => setCreating(true)} className="hover:text-ink">+ Channel</button>
          <button onClick={addCategory} className="hover:text-ink">+ Category</button>
        </div>
```
to:
```tsx
        {isManager && (
          <div className="flex gap-2 mt-3 text-xs">
            <button onClick={() => setCreating(true)} className="hover:text-ink">+ Channel</button>
            <button onClick={addCategory} className="hover:text-ink">+ Category</button>
          </div>
        )}
```
Also pass `isManager` to the settings dialog. Change:
```tsx
      {settings && server && (
        <ServerSettingsDialog server={server} onSaved={load} onClose={() => setSettings(false)} />
      )}
```
to:
```tsx
      {settings && server && (
        <ServerSettingsDialog server={server} isManager={isManager} onSaved={load} onClose={() => setSettings(false)} />
      )}
```
(The server-name button that opens settings stays visible to everyone so members can still Leave.)

- [ ] **Step 2: Gate rename/icon in `src/components/ServerSettingsDialog.tsx`.** Add `isManager` to the props type and destructure it:
```tsx
export function ServerSettingsDialog({
  server,
  isManager,
  onSaved,
  onClose,
}: {
  server: Server;
  isManager: boolean;
  onSaved: () => void;
  onClose: () => void;
}) {
```
Wrap the icon row + name input + Save button so they only render for managers, leaving the heading, error, and **Leave server** button for everyone. Concretely, wrap this block:
```tsx
        <div className="flex items-center gap-3 mb-3">
          <ServerIcon iconUrl={server.icon_url} name={server.name} size="lg" />
          <button onClick={() => fileRef.current?.click()} disabled={busy}
            className="text-sm bg-accent hover:bg-accent-strong text-white rounded-lg px-3 py-1.5 disabled:opacity-50">
            Upload icon
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickIcon} />
        </div>
        <label className="text-muted text-xs">Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)}
          className="w-full p-2 rounded-lg bg-surface-2 text-ink mt-1 mb-3" />
        <button onClick={saveName} disabled={busy}
          className="w-full bg-accent hover:bg-accent-strong text-white font-medium rounded-lg p-2 disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
```
in `{isManager && ( ... )}` so it renders only for managers. The `Leave server` button below it stays outside the guard (available to all). Non-managers see just the heading + Leave.

- [ ] **Step 3: Remove the auto-join in `src/app/register/page.tsx`.** Delete the auto-join block so registration goes straight to the landing. Change:
```tsx
    // Auto-join the shared default (oldest) server so new users land in a channel,
    // not a dead end. New accounts aren't members of anything otherwise.
    const { data: def } = await supabase
      .from("servers").select("id").order("created_at").limit(1).maybeSingle();
    if (def) await supabase.from("server_members").insert({ server_id: def.id, user_id: data.user.id });
    router.push("/channels/first");
```
to:
```tsx
    router.push("/channels/first");
```
(With no default server, new users land on the `/dms` home and create/join a server themselves — the `/channels/first` route already redirects there when the user is in zero servers.)

- [ ] **Step 4: Verify build + tests** — `npm run build && npm test`. Expected: build clean; 42 tests pass.

- [ ] **Step 5: Commit**
```bash
git add src/components/ServerSidebar.tsx src/components/ServerSettingsDialog.tsx src/app/register/page.tsx
git commit -m "feat: gate channel/server management UI to managers; drop auto-join"
```

---

## Task 5: Final verification + merge

**Files:** none (verification)

- [ ] **Step 1: Full build + tests** — `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/mallow/projects/website && npm run build && npm test`. Expected: build clean; 42 tests pass.

- [ ] **Step 2: Backend smoke test** of the role RLS. Create `smoke-roles.cjs`:
```js
const { createClient } = require("@supabase/supabase-js");
function mk() { return createClient(process.env.SB_URL, process.env.SB_KEY); }
async function signup(sb, tag) {
  const s = Date.now() + Math.floor(Math.random() * 1000);
  const { data, error } = await sb.auth.signUp({ email: `role.${tag}.${s}@gmail.com`, password: "TestPass123!" });
  if (error) throw new Error("signup " + tag + ": " + error.message);
  const uid = data.user.id;
  await sb.from("profiles").insert({ id: uid, username: "r" + tag + (s % 100000), display_name: "R" + tag });
  return uid;
}
(async () => {
  const O = mk(); const oUid = await signup(O, "o");
  const { data: srv } = await O.rpc("create_server", { server_name: "Roles Server" });
  const { data: cat } = await O.from("categories").select("id").eq("server_id", srv).single();

  const M = mk(); const mUid = await signup(M, "m");
  await M.from("server_members").insert({ server_id: srv, user_id: mUid });
  // member self-inserted as member; try to self-escalate to admin (must fail or stay member)
  const { error: escErr } = await M.from("server_members").update({ role: "admin" }).eq("server_id", srv).eq("user_id", mUid);
  const { data: mrow } = await M.from("server_members").select("role").eq("server_id", srv).eq("user_id", mUid).single();
  console.log("member self-promote blocked:", mrow?.role === "member" ? "OK (still member)" : ">> ESCALATED");
  // member creates a channel (must fail via RLS)
  const { error: chErr } = await M.from("channels").insert({ name: "sneaky", server_id: srv, category_id: cat.id, position: 1 });
  console.log("member creates channel (EXPECT ERR):", chErr ? "blocked OK" : ">> ALLOWED");

  // owner promotes member -> admin
  const { error: promErr } = await O.from("server_members").update({ role: "admin" }).eq("server_id", srv).eq("user_id", mUid);
  console.log("owner promotes member:", promErr ? "ERR " + promErr.message : "OK");
  // now the (admin) member can create a channel
  const { error: ch2 } = await M.from("channels").insert({ name: "admin-made", server_id: srv, category_id: cat.id, position: 2 });
  console.log("admin creates channel:", ch2 ? "ERR " + ch2.message : "OK");
  // owner cannot be demoted below power: even if role set, owner stays manager (owner_id based) — verify owner can still manage
  const { error: ownEdit } = await O.from("servers").update({ name: "Renamed" }).eq("id", srv);
  console.log("owner edits server:", ownEdit ? "ERR " + ownEdit.message : "OK");

  console.log("SMOKE_DONE");
})().catch((e) => console.log("FATAL:", e.message));
```
Run:
```bash
set -a; . ./.env.local; set +a
SB_URL="$NEXT_PUBLIC_SUPABASE_URL" SB_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" node smoke-roles.cjs
rm -f smoke-roles.cjs
```
Expected: `member self-promote blocked: OK (still member)`, `member creates channel (EXPECT ERR): blocked OK`, `owner promotes member: OK`, `admin creates channel: OK`, `owner edits server: OK`, `SMOKE_DONE`.

- [ ] **Step 3: Manual checklist** (`npm run dev`, http://localhost:3000, two browsers):
  - Existing accounts now land on the **DM home** (Our Server is gone) — create a fresh server (you're **owner**, land in #general).
  - Send messages → each appears **gray then goes fully opaque**; force-fail (e.g. offline) reverts it with the text restored.
  - Second user joins the server from the directory (member): **no + Channel/+ Category**, and opening the server name → settings shows only **Leave** (no rename/icon).
  - Open **👥 Members** → both listed with badges (Owner/member). Promote the member to **admin** → they now see + buttons + rename/icon. Demote → gated again.
  - Members panel updates live in both browsers.
  - Stop the dev server when done.

- [ ] **Step 4: Merge to main.**
```bash
git checkout main
git merge feat/roles-optimistic
git branch -d feat/roles-optimistic
```

- [ ] **Step 5: Done.**

---

## Done Criteria

- Roles gate channel/category/server + role management to owner+admins; members can't self-escalate; owner keeps power regardless of role.
- Members panel lists members with roles and lets managers promote/demote.
- Legacy "Our Server" is deleted; existing users create/join fresh servers.
- Optimistic send shows gray→opaque and reverts on failure.
- `npm run build` + `npm test` (42) pass; backend smoke test passes; manual checklist passes; merged to `main`.
