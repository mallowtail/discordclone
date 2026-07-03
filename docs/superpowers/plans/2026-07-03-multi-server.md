# Multi-Server Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real servers (with membership, categories, and per-server channels), a Discord-style server rail separating servers from DMs, create/join/leave + channel/category creation, and initials/custom server icons — migrating the existing hardcoded server with no loss of access.

**Architecture:** New `servers`/`server_members`/`categories` tables; `channels` gains `server_id`/`category_id` and channel access becomes membership-based via RLS. Server creation is atomic through a `create_server` DB function. The `(app)` layout renders a `ServerRail` + a server-or-DM sidebar; channels route by id. Pure logic (initials/color) is tested; UI reuses existing patterns (dialogs, `Avatar`-style icon component, Storage upload helper).

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (Postgres + RLS + Realtime + Storage), Tailwind v4, Vitest.

## Global Constraints

- Node via nvm, NOT on PATH: prefix node/npm commands with `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"`.
- Branch: `feat/multi-server` — never switch branches.
- Migrations `0005`/`0006` and the storage bucket are run MANUALLY by the human in the Supabase SQL editor; subagents only write the `.sql` files.
- Theme tokens only (no hardcoded hex): `bg-app bg-sidebar bg-surface bg-surface-2 border-line text-ink text-muted text-accent bg-accent hover:bg-accent-strong text-danger` (opacity modifiers OK).
- Appearance/logic changes must not break the existing 32 unit tests.

---

## File Structure

```
supabase/migrations/
  0005_servers.sql                  # NEW: tables, channel cols, RLS, helpers, create_server, migrate
  0006_server_icons_bucket.sql      # NEW: server-icons Storage bucket
src/
  types/db.ts                       # MODIFY: Server/ServerMember/Category types; Channel gains server_id/category_id
  lib/
    server-icon.ts                  # NEW: serverInitials(), colorFromName()  (pure, tested)
    upload.ts                       # MODIFY: uploadServerIcon()
  hooks/useServers.ts               # NEW: current user's servers, live
  components/
    ServerIcon.tsx                  # NEW: image or initials circle
    ServerRail.tsx                  # NEW: Home + server icons + add
    AddServerDialog.tsx             # NEW: create / join(directory) tabs
    ServerSettingsDialog.tsx        # NEW: rename + custom icon
    CreateChannelDialog.tsx         # NEW: add channel (name + category)
    ServerSidebar.tsx               # NEW: categories + channels + create/settings (for a server)
    DmSidebar.tsx                   # NEW: the DM list (extracted from old Sidebar)
  app/(app)/layout.tsx              # MODIFY: ServerRail + active view + sidebar switch
  app/(app)/channels/[channelId]/page.tsx  # MODIFY: resolve channel by id
  app/page.tsx                      # MODIFY: land on default server's first channel
  app/login/page.tsx, register/page.tsx    # MODIFY: redirect to "/" (which resolves landing)
```

Note: the old `src/components/Sidebar.tsx` is replaced by `ServerSidebar` + `DmSidebar` selected by the layout; delete `Sidebar.tsx` in Task 8.

---

## Task 1: Migration 0005 (schema, RLS, create_server, migrate) + types

**Files:**
- Create: `supabase/migrations/0005_servers.sql`
- Modify: `src/types/db.ts`

**Interfaces:**
- Produces (SQL, called from later tasks): RPC `create_server(server_name text) -> uuid`; tables `servers`, `server_members`, `categories`; `channels.server_id`, `channels.category_id`.
- Produces (types): `Server`, `ServerMember`, `Category`; `Channel` gains `server_id: string`, `category_id: string | null`.

- [ ] **Step 1: Write `supabase/migrations/0005_servers.sql`**

```sql
-- ===== TABLES =====
create table public.servers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  icon_url text,
  owner_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.server_members (
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (server_id, user_id)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  name text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

-- ===== CHANNELS: add server_id + category_id; drop global-unique name =====
alter table public.channels add column if not exists server_id uuid references public.servers(id) on delete cascade;
alter table public.channels add column if not exists category_id uuid references public.categories(id) on delete set null;
alter table public.channels drop constraint if exists channels_name_key;
alter table public.channels drop constraint if exists channels_name_unique;

-- ===== MIGRATE the existing hardcoded server =====
do $$
declare srv uuid; cat uuid;
begin
  if exists (select 1 from public.channels where server_id is null) then
    insert into public.servers (name) values ('Our Server') returning id into srv;
    insert into public.categories (server_id, name, position) values (srv, 'Text Channels', 0) returning id into cat;
    update public.channels set server_id = srv, category_id = cat where server_id is null;
    insert into public.server_members (server_id, user_id)
      select srv, id from public.profiles on conflict do nothing;
  end if;
end $$;

alter table public.channels alter column server_id set not null;

-- ===== HELPERS =====
create or replace function public.is_server_member(srv uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from public.server_members where server_id = srv and user_id = auth.uid());
$$;

create or replace function public.is_channel_member(chan uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.channels c
    join public.server_members sm on sm.server_id = c.server_id
    where c.id = chan and sm.user_id = auth.uid()
  );
$$;

-- ===== RLS: new tables =====
alter table public.servers enable row level security;
alter table public.server_members enable row level security;
alter table public.categories enable row level security;

create policy "servers readable by authenticated" on public.servers for select to authenticated using (true);
create policy "create own server" on public.servers for insert to authenticated with check (owner_id = auth.uid());
create policy "members update server" on public.servers for update to authenticated using (public.is_server_member(id));

create policy "read server membership" on public.server_members for select to authenticated using (public.is_server_member(server_id));
create policy "self join server" on public.server_members for insert to authenticated with check (user_id = auth.uid());
create policy "self leave server" on public.server_members for delete to authenticated using (user_id = auth.uid());

create policy "members read categories" on public.categories for select to authenticated using (public.is_server_member(server_id));
create policy "members insert categories" on public.categories for insert to authenticated with check (public.is_server_member(server_id));
create policy "members update categories" on public.categories for update to authenticated using (public.is_server_member(server_id));
create policy "members delete categories" on public.categories for delete to authenticated using (public.is_server_member(server_id));

-- ===== RLS: channels become membership-based =====
drop policy if exists "channels readable by authenticated" on public.channels;
create policy "members read channels" on public.channels for select to authenticated using (public.is_server_member(server_id));
create policy "members insert channels" on public.channels for insert to authenticated with check (public.is_server_member(server_id));
create policy "members update channels" on public.channels for update to authenticated using (public.is_server_member(server_id));
create policy "members delete channels" on public.channels for delete to authenticated using (public.is_server_member(server_id));

-- ===== RLS: channel messages require server membership =====
drop policy if exists "read channel messages" on public.messages;
create policy "read channel messages" on public.messages for select to authenticated
  using (channel_id is not null and public.is_channel_member(channel_id));

drop policy if exists "send messages" on public.messages;
create policy "send messages" on public.messages for insert to authenticated
  with check (
    author_id = auth.uid() and (
      (channel_id is not null and public.is_channel_member(channel_id))
      or (conversation_id is not null and public.is_conversation_member(conversation_id))
    )
  );

create or replace function public.can_read_message(msg uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.messages m
    where m.id = msg and (
      (m.channel_id is not null and public.is_channel_member(m.channel_id))
      or (m.conversation_id is not null and public.is_conversation_member(m.conversation_id))
    )
  );
$$;

-- ===== create_server (atomic: server + membership + category + #general) =====
create or replace function public.create_server(server_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare srv uuid; cat uuid;
begin
  insert into public.servers (name, owner_id) values (server_name, auth.uid()) returning id into srv;
  insert into public.server_members (server_id, user_id) values (srv, auth.uid());
  insert into public.categories (server_id, name, position) values (srv, 'Text Channels', 0) returning id into cat;
  insert into public.channels (name, position, server_id, category_id) values ('general', 0, srv, cat);
  return srv;
end $$;
grant execute on function public.create_server(text) to authenticated;

-- ===== REALTIME =====
alter publication supabase_realtime add table public.servers;
alter publication supabase_realtime add table public.server_members;
alter publication supabase_realtime add table public.categories;
alter publication supabase_realtime add table public.channels;
```

- [ ] **Step 2: Run it in Supabase** (SQL Editor → New query → Run). Expected: "Success. No rows returned." Verify: `servers` has one row "Our Server"; `server_members` has one row per existing user; `channels` all have a `server_id`.

- [ ] **Step 3: Update `src/types/db.ts`** — add the three types and extend `Channel` (keep `Profile`, `Message`, `Reaction` unchanged):

```ts
export type Server = {
  id: string;
  name: string;
  icon_url: string | null;
  owner_id: string | null;
  created_at: string;
};

export type ServerMember = {
  server_id: string;
  user_id: string;
  joined_at: string;
};

export type Category = {
  id: string;
  server_id: string;
  name: string;
  position: number;
  created_at: string;
};
```
and replace the `Channel` type with:
```ts
export type Channel = {
  id: string;
  name: string;
  position: number;
  created_at: string;
  server_id: string;
  category_id: string | null;
};
```

- [ ] **Step 4: Verify build** — `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/mallow/projects/website && npm run build`. Expected: success (new optional/added fields don't break existing reads).

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/0005_servers.sql src/types/db.ts
git commit -m "feat: multi-server schema, membership RLS, and create_server function"
```

---

## Task 2: server-icons Storage bucket

**Files:**
- Create: `supabase/migrations/0006_server_icons_bucket.sql`

- [ ] **Step 1: Write `supabase/migrations/0006_server_icons_bucket.sql`**

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('server-icons', 'server-icons', true, 2097152,
        array['image/png','image/jpeg','image/gif','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "authenticated upload server-icons" on storage.objects;
create policy "authenticated upload server-icons"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'server-icons');

drop policy if exists "public read server-icons" on storage.objects;
create policy "public read server-icons"
  on storage.objects for select to public
  using (bucket_id = 'server-icons');
```

- [ ] **Step 2: Run it in Supabase.** Expected: "Success." Verify a `server-icons` bucket exists (public).

- [ ] **Step 3: Commit**
```bash
git add supabase/migrations/0006_server_icons_bucket.sql
git commit -m "feat: add server-icons Storage bucket"
```

---

## Task 3: Server-icon logic (TDD), ServerIcon component, uploadServerIcon

**Files:**
- Create: `src/lib/server-icon.ts`
- Test: `tests/server-icon.test.ts`
- Create: `src/components/ServerIcon.tsx`
- Modify: `src/lib/upload.ts`

**Interfaces:**
- Produces: `serverInitials(name: string): string`; `colorFromName(name: string): string` (hsl string); `<ServerIcon iconUrl={string|null} name={string} size?: "md"|"lg" />`; `uploadServerIcon(file: File): Promise<{ url: string } | { error: string }>`.

- [ ] **Step 1: Write the failing test `tests/server-icon.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { serverInitials, colorFromName } from "@/lib/server-icon";

describe("serverInitials", () => {
  it("one word -> first two letters", () => {
    expect(serverInitials("test")).toBe("TE");
  });
  it("two words -> first letter of each", () => {
    expect(serverInitials("two words")).toBe("TW");
  });
  it("three+ words -> first letter of first two words", () => {
    expect(serverInitials("three two words")).toBe("TT");
  });
  it("trims and collapses extra whitespace", () => {
    expect(serverInitials("  hello   world  ")).toBe("HW");
  });
  it("single-character name -> that letter", () => {
    expect(serverInitials("x")).toBe("X");
  });
});

describe("colorFromName", () => {
  it("is stable for the same name", () => {
    expect(colorFromName("test")).toBe(colorFromName("test"));
  });
  it("differs for clearly different names", () => {
    expect(colorFromName("alpha")).not.toBe(colorFromName("zulu"));
  });
});
```

- [ ] **Step 2: Run, confirm FAIL** — `npm test`. Expected: FAIL (`@/lib/server-icon` missing).

- [ ] **Step 3: Implement `src/lib/server-icon.ts`**

```ts
export function serverInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function colorFromName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h}, 45%, 45%)`;
}
```

- [ ] **Step 4: Run, confirm PASS** — `npm test`. Expected: all pass (7 new + existing 32).

- [ ] **Step 5: Create `src/components/ServerIcon.tsx`**

```tsx
"use client";

import { useState } from "react";
import { serverInitials, colorFromName } from "@/lib/server-icon";

const SIZES = { md: "w-11 h-11 text-sm rounded-2xl", lg: "w-14 h-14 text-lg rounded-2xl" } as const;

export function ServerIcon({
  iconUrl,
  name,
  size = "md",
}: {
  iconUrl: string | null;
  name: string;
  size?: keyof typeof SIZES;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = !!iconUrl && !failed;
  if (showImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={iconUrl!}
        alt={name}
        onError={() => setFailed(true)}
        className={`${SIZES[size]} object-cover flex-none`}
      />
    );
  }
  return (
    <div
      className={`${SIZES[size]} flex items-center justify-center font-bold text-white flex-none`}
      style={{ background: colorFromName(name) }}
    >
      {serverInitials(name)}
    </div>
  );
}
```

- [ ] **Step 6: Add `uploadServerIcon` to `src/lib/upload.ts`.** Read the file; keep `validateImage`, `uploadImage`, `uploadAvatar` unchanged; append:
```ts
export async function uploadServerIcon(file: File): Promise<{ url: string } | { error: string }> {
  const check = validateImage(file);
  if (!check.ok) return { error: check.error };
  const supabase = createClient();
  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from("server-icons")
    .upload(path, file, { contentType: file.type });
  if (error) return { error: `Upload failed: ${error.message}` };
  const { data } = supabase.storage.from("server-icons").getPublicUrl(path);
  return { url: data.publicUrl };
}
```

- [ ] **Step 7: Verify build + tests** — `npm run build && npm test`. Expected: build clean; all tests pass.

- [ ] **Step 8: Commit**
```bash
git add src/lib/server-icon.ts tests/server-icon.test.ts src/components/ServerIcon.tsx src/lib/upload.ts
git commit -m "feat: server icon initials/color logic, ServerIcon, uploadServerIcon"
```

---

## Task 4: useServers hook + ServerRail + AddServerDialog

**Files:**
- Create: `src/hooks/useServers.ts`
- Create: `src/components/ServerRail.tsx`
- Create: `src/components/AddServerDialog.tsx`

**Interfaces:**
- Consumes: `ServerIcon`; `Server` type; `create_server` RPC; `useAuth`.
- Produces: `useServers(): { servers: Server[]; reload: () => void }`; `<ServerRail activeServerId={string|null} onSelectServer={(id)=>void} onSelectHome={()=>void} />`; `<AddServerDialog onClose />`.

- [ ] **Step 1: Create `src/hooks/useServers.ts`**

```ts
"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import type { Server } from "@/types/db";

export function useServers(): { servers: Server[]; reload: () => void } {
  const supabase = createClient();
  const { user } = useAuth();
  const [servers, setServers] = useState<Server[]>([]);

  const reload = useCallback(async () => {
    if (!user) {
      setServers([]);
      return;
    }
    const { data } = await supabase
      .from("server_members")
      .select("servers(*)")
      .eq("user_id", user.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list = (data ?? []).map((r: any) => r.servers as Server).filter(Boolean);
    list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    setServers(list);
  }, [supabase, user]);

  useEffect(() => {
    reload();
    if (!user) return;
    const channel = supabase
      .channel(`servers:${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "server_members" }, () => reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "servers" }, () => reload())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, user, reload]);

  return { servers, reload };
}
```

- [ ] **Step 2: Create `src/components/AddServerDialog.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import type { Server } from "@/types/db";
import { ServerIcon } from "@/components/ServerIcon";

export function AddServerDialog({ onClose }: { onClose: () => void }) {
  const supabase = createClient();
  const router = useRouter();
  const { user } = useAuth();
  const [tab, setTab] = useState<"create" | "join">("create");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [directory, setDirectory] = useState<Server[]>([]);

  useEffect(() => {
    supabase.from("servers").select("*").then(({ data }) => setDirectory((data as Server[]) ?? []));
  }, [supabase]);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return setError("Enter a server name");
    setError(null);
    setBusy(true);
    const { data, error: err } = await supabase.rpc("create_server", { server_name: trimmed });
    setBusy(false);
    if (err) return setError("Couldn't create — try again");
    onClose();
    router.push(`/channels/first?server=${data}`);
  }

  async function join(serverId: string) {
    if (!user) return;
    const { error: err } = await supabase
      .from("server_members")
      .insert({ server_id: serverId, user_id: user.id });
    if (err && !err.message.includes("duplicate")) return setError("Couldn't join — try again");
    onClose();
    router.push(`/channels/first?server=${serverId}`);
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface p-5 rounded-xl w-96 border border-line" onClick={(e) => e.stopPropagation()}>
        <div className="flex gap-2 mb-4 text-sm">
          <button onClick={() => setTab("create")}
            className={`px-3 py-1 rounded-lg ${tab === "create" ? "bg-accent text-white" : "text-muted"}`}>Create</button>
          <button onClick={() => setTab("join")}
            className={`px-3 py-1 rounded-lg ${tab === "join" ? "bg-accent text-white" : "text-muted"}`}>Join</button>
        </div>
        {error && <p className="text-danger text-sm mb-2">{error}</p>}
        {tab === "create" ? (
          <>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Server name"
              className="w-full p-2 rounded-lg bg-surface-2 text-ink mb-3" />
            <button onClick={create} disabled={busy}
              className="w-full bg-accent hover:bg-accent-strong text-white font-medium rounded-lg p-2 disabled:opacity-50">
              {busy ? "Creating…" : "Create server"}
            </button>
          </>
        ) : (
          <ul className="max-h-72 overflow-y-auto flex flex-col gap-1">
            {directory.map((s) => (
              <li key={s.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-surface-2">
                <ServerIcon iconUrl={s.icon_url} name={s.name} />
                <span className="text-ink flex-1 truncate">{s.name}</span>
                <button onClick={() => join(s.id)}
                  className="text-xs bg-accent hover:bg-accent-strong text-white rounded-lg px-3 py-1">Join</button>
              </li>
            ))}
            {directory.length === 0 && <li className="text-muted text-sm p-2">No servers yet.</li>}
          </ul>
        )}
      </div>
    </div>
  );
}
```

Note: navigation uses `/channels/first?server=<id>` — a small redirect route resolved in Task 7 that sends the user to that server's first channel by id. (Defined there; do not implement it here.)

- [ ] **Step 3: Create `src/components/ServerRail.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useServers } from "@/hooks/useServers";
import { ServerIcon } from "@/components/ServerIcon";
import { AddServerDialog } from "@/components/AddServerDialog";

export function ServerRail({
  activeServerId,
  onSelectServer,
  onSelectHome,
}: {
  activeServerId: string | null;
  onSelectServer: (id: string) => void;
  onSelectHome: () => void;
}) {
  const { servers } = useServers();
  const [adding, setAdding] = useState(false);

  return (
    <div className="w-[72px] bg-surface-2 flex flex-col items-center py-3 gap-2 overflow-y-auto">
      <button
        onClick={onSelectHome}
        title="Direct Messages"
        className={`w-11 h-11 flex items-center justify-center text-lg ${
          activeServerId === null ? "bg-accent rounded-2xl" : "bg-surface rounded-full hover:rounded-2xl"
        }`}
      >
        💬
      </button>
      <div className="w-8 h-px bg-line my-1" />
      {servers.map((s) => (
        <button
          key={s.id}
          onClick={() => onSelectServer(s.id)}
          title={s.name}
          className={activeServerId === s.id ? "ring-2 ring-accent rounded-2xl" : ""}
        >
          <ServerIcon iconUrl={s.icon_url} name={s.name} />
        </button>
      ))}
      <button
        onClick={() => setAdding(true)}
        title="Add a server"
        className="w-11 h-11 rounded-full bg-surface text-accent text-xl hover:rounded-2xl"
      >
        +
      </button>
      {adding && <AddServerDialog onClose={() => setAdding(false)} />}
    </div>
  );
}
```

- [ ] **Step 4: Verify build** — `npm run build`. Expected: success (unused-until-wired components compile). Do NOT leave a dev server running.

- [ ] **Step 5: Commit**
```bash
git add src/hooks/useServers.ts src/components/ServerRail.tsx src/components/AddServerDialog.tsx
git commit -m "feat: server rail, add/join server dialog, useServers hook"
```

---

## Task 5: ServerSidebar + CreateChannelDialog + ServerSettingsDialog

**Files:**
- Create: `src/components/CreateChannelDialog.tsx`
- Create: `src/components/ServerSettingsDialog.tsx`
- Create: `src/components/ServerSidebar.tsx`

**Interfaces:**
- Consumes: `Server`, `Category`, `Channel` types; `ServerIcon`; `uploadServerIcon`; `useAuth`.
- Produces: `<ServerSidebar serverId={string} />` (self-loads server, categories, channels; renders channel links by id; hosts create-channel/category + settings).

- [ ] **Step 1: Create `src/components/CreateChannelDialog.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Category } from "@/types/db";

export function CreateChannelDialog({
  serverId,
  categories,
  onClose,
}: {
  serverId: string;
  categories: Category[];
  onClose: () => void;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<string>(categories[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const trimmed = name.trim().replace(/\s+/g, "-").toLowerCase();
    if (!trimmed) return setError("Enter a channel name");
    setError(null);
    setBusy(true);
    const { data, error: err } = await supabase
      .from("channels")
      .insert({ name: trimmed, server_id: serverId, category_id: categoryId || null, position: 0 })
      .select("id")
      .single();
    setBusy(false);
    if (err) return setError("Couldn't create — try again");
    onClose();
    router.push(`/channels/${data.id}`);
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface p-5 rounded-xl w-80 border border-line" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-ink font-semibold mb-3">Create channel</h2>
        {error && <p className="text-danger text-sm mb-2">{error}</p>}
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
          placeholder="channel-name" className="w-full p-2 rounded-lg bg-surface-2 text-ink mb-3" />
        {categories.length > 0 && (
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
            className="w-full p-2 rounded-lg bg-surface-2 text-ink mb-3">
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
        <button onClick={create} disabled={busy}
          className="w-full bg-accent hover:bg-accent-strong text-white font-medium rounded-lg p-2 disabled:opacity-50">
          {busy ? "Creating…" : "Create"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/components/ServerSettingsDialog.tsx`**

```tsx
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { uploadServerIcon } from "@/lib/upload";
import { ServerIcon } from "@/components/ServerIcon";
import type { Server } from "@/types/db";

export function ServerSettingsDialog({
  server,
  onSaved,
  onClose,
}: {
  server: Server;
  onSaved: () => void;
  onClose: () => void;
}) {
  const supabase = createClient();
  const router = useRouter();
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(server.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function leave() {
    if (!user) return;
    if (!confirm(`Leave ${server.name}?`)) return;
    await supabase.from("server_members").delete().eq("server_id", server.id).eq("user_id", user.id);
    onClose();
    router.replace("/channels/first");
  }

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed) return setError("Enter a name");
    setBusy(true);
    const { error: err } = await supabase.from("servers").update({ name: trimmed }).eq("id", server.id);
    setBusy(false);
    if (err) return setError("Couldn't save — try again");
    onSaved();
    onClose();
  }

  async function onPickIcon(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setBusy(true);
    const res = await uploadServerIcon(file);
    if ("error" in res) {
      setBusy(false);
      return setError(res.error);
    }
    const { error: err } = await supabase.from("servers").update({ icon_url: res.url }).eq("id", server.id);
    setBusy(false);
    if (err) return setError("Couldn't save icon — try again");
    onSaved();
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface p-5 rounded-xl w-80 border border-line" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-ink font-semibold mb-3">Server settings</h2>
        {error && <p className="text-danger text-sm mb-2">{error}</p>}
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
        <button onClick={leave} disabled={busy}
          className="w-full text-danger text-sm mt-3 hover:underline disabled:opacity-50">
          Leave server
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/components/ServerSidebar.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Server, Category, Channel } from "@/types/db";
import { CreateChannelDialog } from "@/components/CreateChannelDialog";
import { ServerSettingsDialog } from "@/components/ServerSettingsDialog";

export function ServerSidebar({ serverId }: { serverId: string }) {
  const supabase = createClient();
  const [server, setServer] = useState<Server | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);
  const [settings, setSettings] = useState(false);

  const load = useCallback(async () => {
    const [{ data: s }, { data: cats }, { data: chs }] = await Promise.all([
      supabase.from("servers").select("*").eq("id", serverId).single(),
      supabase.from("categories").select("*").eq("server_id", serverId).order("position"),
      supabase.from("channels").select("*").eq("server_id", serverId).order("position"),
    ]);
    setServer((s as Server) ?? null);
    setCategories((cats as Category[]) ?? []);
    setChannels((chs as Channel[]) ?? []);
  }, [supabase, serverId]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`server-sidebar:${serverId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "channels", filter: `server_id=eq.${serverId}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "categories", filter: `server_id=eq.${serverId}` }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, serverId, load]);

  async function addCategory() {
    const name = prompt("Category name")?.trim();
    if (!name) return;
    await supabase.from("categories").insert({ server_id: serverId, name, position: categories.length });
  }

  function channelsIn(categoryId: string | null) {
    return channels.filter((c) => c.category_id === categoryId);
  }

  const uncategorized = channelsIn(null);

  return (
    <aside className="w-60 bg-sidebar flex flex-col">
      <button
        onClick={() => setSettings(true)}
        className="p-3 font-bold text-ink border-b border-line flex items-center justify-between hover:bg-surface"
      >
        <span className="truncate">{server?.name ?? "…"}</span>
        <span className="text-muted text-sm">⚙</span>
      </button>
      <nav className="flex-1 overflow-y-auto p-2 text-muted">
        {uncategorized.map((c) => (
          <Link key={c.id} href={`/channels/${c.id}`}
            className="block px-2 py-1 rounded hover:bg-surface hover:text-ink"># {c.name}</Link>
        ))}
        {categories.map((cat) => (
          <div key={cat.id}>
            <button
              onClick={() => setCollapsed((p) => ({ ...p, [cat.id]: !p[cat.id] }))}
              className="w-full flex items-center gap-1 text-[10px] uppercase tracking-wide mt-3 mb-1 hover:text-ink"
            >
              <span>{collapsed[cat.id] ? "▸" : "▾"}</span> {cat.name}
            </button>
            {!collapsed[cat.id] &&
              channelsIn(cat.id).map((c) => (
                <Link key={c.id} href={`/channels/${c.id}`}
                  className="block px-2 py-1 ml-2 rounded hover:bg-surface hover:text-ink"># {c.name}</Link>
              ))}
          </div>
        ))}
        <div className="flex gap-2 mt-3 text-xs">
          <button onClick={() => setCreating(true)} className="hover:text-ink">+ Channel</button>
          <button onClick={addCategory} className="hover:text-ink">+ Category</button>
        </div>
      </nav>
      {creating && <CreateChannelDialog serverId={serverId} categories={categories} onClose={() => setCreating(false)} />}
      {settings && server && (
        <ServerSettingsDialog server={server} onSaved={load} onClose={() => setSettings(false)} />
      )}
    </aside>
  );
}
```

- [ ] **Step 4: Verify build** — `npm run build`. Expected: success.

- [ ] **Step 5: Commit**
```bash
git add src/components/CreateChannelDialog.tsx src/components/ServerSettingsDialog.tsx src/components/ServerSidebar.tsx
git commit -m "feat: server sidebar with categories, channel creation, and settings"
```

---

## Task 6: DmSidebar (extract the DM list)

**Files:**
- Create: `src/components/DmSidebar.tsx`

**Interfaces:**
- Produces: `<DmSidebar />` (the current-user DM list + user panel + profile dialog + sign out — the non-channel half of the old Sidebar).

- [ ] **Step 1: Create `src/components/DmSidebar.tsx`** (this is the old `Sidebar`'s DM list + user panel, minus the channels which now live in `ServerSidebar`):

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import type { Profile } from "@/types/db";
import { NewDmDialog } from "@/components/NewDmDialog";
import { Avatar } from "@/components/Avatar";
import { ProfileDialog } from "@/components/ProfileDialog";

export function DmSidebar() {
  const supabase = createClient();
  const router = useRouter();
  const { user, profile, signOut } = useAuth();
  const [dms, setDms] = useState<{ id: string; other: Profile }[]>([]);
  const [showProfile, setShowProfile] = useState(false);

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
      <div className="p-3 font-bold text-ink border-b border-line">Direct Messages</div>
      <nav className="flex-1 overflow-y-auto p-2 text-muted">
        <div className="flex items-center justify-between text-xs uppercase mt-2 mb-1">
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
        <button onClick={() => setShowProfile(true)}
          className="flex items-center gap-2 min-w-0 hover:opacity-80" title="Edit profile">
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

- [ ] **Step 2: Verify build** — `npm run build`. Expected: success.

- [ ] **Step 3: Commit**
```bash
git add src/components/DmSidebar.tsx
git commit -m "feat: extract DM list into DmSidebar"
```

---

## Task 7: App shell restructure + channel routing by id + landing

**Files:**
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/app/(app)/channels/[channelId]/page.tsx`
- Create: `src/app/(app)/channels/first/page.tsx`
- Modify: `src/app/page.tsx`
- Delete: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `ServerRail`, `ServerSidebar`, `DmSidebar`, `useServers`.
- Produces: the shell (rail + active sidebar + page); channel page resolves by id; `/channels/first?server=<id>` redirect route; root landing.

- [ ] **Step 1: Replace `src/app/(app)/layout.tsx`** with (rail + active view + sidebar switch):

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { ServerRail } from "@/components/ServerRail";
import { ServerSidebar } from "@/components/ServerSidebar";
import { DmSidebar } from "@/components/DmSidebar";
import { useServers } from "@/hooks/useServers";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const { servers } = useServers();
  // null = Home (DMs); otherwise the active server id
  const [view, setView] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  // default to the first server once servers load (until the user picks Home/another)
  useEffect(() => {
    if (!touched && view === null && servers.length > 0) setView(servers[0].id);
  }, [servers, touched, view]);

  if (loading || !user) return <div className="p-6 text-muted">Loading…</div>;

  return (
    <div className="flex h-screen">
      <ServerRail
        activeServerId={view}
        onSelectServer={(id) => { setTouched(true); setView(id); }}
        onSelectHome={() => { setTouched(true); setView(null); }}
      />
      {view === null ? <DmSidebar /> : <ServerSidebar serverId={view} />}
      <main className="flex-1 flex flex-col min-w-0">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Replace `src/app/(app)/channels/[channelId]/page.tsx`** — resolve by **id** (only the query line and the initial redirect change; keep ChannelView intact):

```tsx
"use client";

import { use, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Channel, Message } from "@/types/db";
import { useMessages } from "@/hooks/useMessages";
import { MessageList } from "@/components/MessageList";
import { MessageInput } from "@/components/MessageInput";
import { PinnedPanel } from "@/components/PinnedPanel";

export default function ChannelPage({ params }: { params: Promise<{ channelId: string }> }) {
  const { channelId: id } = use(params);
  const supabase = createClient();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    supabase.from("channels").select("*").eq("id", id).single()
      .then(({ data }) => {
        if (data) setChannel(data as Channel);
        else setMissing(true);
      });
  }, [supabase, id]);

  if (missing) return <div className="p-4 text-muted">Channel not found.</div>;
  if (!channel) return <div className="p-4 text-muted">Loading channel…</div>;
  return <ChannelView channel={channel} />;
}

function ChannelView({ channel }: { channel: Channel }) {
  const messages = useMessages({ channelId: channel.id });
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [replyToName, setReplyToName] = useState("");
  const [showPins, setShowPins] = useState(false);
  const pinned = messages.filter((m) => m.pinned);
  return (
    <>
      <header className="p-3 border-b border-line font-semibold text-ink flex items-center justify-between relative">
        <span># {channel.name}</span>
        <button onClick={() => setShowPins((s) => !s)} className="text-xs font-normal text-muted hover:text-ink">
          📌 Pinned ({pinned.length})
        </button>
        {showPins && <PinnedPanel pinned={pinned} onClose={() => setShowPins(false)} />}
      </header>
      <MessageList messages={messages} onReply={(m, name) => { setReplyTo(m); setReplyToName(name); }} />
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

- [ ] **Step 3: Create `src/app/(app)/channels/first/page.tsx`** — resolves the first channel of a server (used by create/join and root landing):

```tsx
"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";

export default function FirstChannel() {
  const supabase = createClient();
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) return;
    (async () => {
      let serverId = params.get("server");
      if (!serverId) {
        const { data: mem } = await supabase
          .from("server_members").select("server_id, servers(created_at)")
          .eq("user_id", user.id);
        // pick the earliest-created server the user belongs to
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sorted = (mem ?? []).slice().sort((a: any, b: any) =>
          (a.servers?.created_at ?? "").localeCompare(b.servers?.created_at ?? ""));
        serverId = sorted[0]?.server_id ?? null;
      }
      if (!serverId) return router.replace("/dms");
      const { data: chans } = await supabase
        .from("channels").select("id").eq("server_id", serverId).order("position").limit(1);
      if (chans && chans[0]) router.replace(`/channels/${chans[0].id}`);
    })();
  }, [supabase, user, loading, params, router]);

  return <div className="p-4 text-muted">Opening…</div>;
}
```

- [ ] **Step 4: Replace `src/app/page.tsx`** — land on the first channel:

```tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    router.replace(user ? "/channels/first" : "/login");
  }, [user, loading, router]);
  return null;
}
```

- [ ] **Step 5: Update the post-login/register redirects.** In `src/app/login/page.tsx` and `src/app/register/page.tsx`, change the `router.push("/channels/general")` line to `router.push("/channels/first")`.

- [ ] **Step 6: Delete the obsolete `src/components/Sidebar.tsx`** — `git rm src/components/Sidebar.tsx`.

- [ ] **Step 7: Verify build + tests** — `npm run build && npm test`. Expected: build clean; 39 tests pass (32 + 7 new). If the build errors that `Sidebar` is still imported anywhere, grep `grep -rn "components/Sidebar" src/` and remove the dead import.

- [ ] **Step 8: Commit**
```bash
git add "src/app/(app)/layout.tsx" "src/app/(app)/channels/[channelId]/page.tsx" "src/app/(app)/channels/first/page.tsx" src/app/page.tsx src/app/login/page.tsx src/app/register/page.tsx
git rm src/components/Sidebar.tsx
git commit -m "feat: server rail + sidebar shell, channel routing by id, first-channel landing"
```

---

## Task 8: Final verification + merge

**Files:** none (verification)

- [ ] **Step 1: Full build + tests** — `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/mallow/projects/website && npm run build && npm test`. Expected: build clean; 39 tests pass.

- [ ] **Step 2: Backend smoke test** of the server model + RLS tightening. Create `smoke-server.cjs`:
```js
const { createClient } = require("@supabase/supabase-js");
function mk() { return createClient(process.env.SB_URL, process.env.SB_KEY); }
async function signup(sb, tag) {
  const s = Date.now() + Math.floor(Math.random() * 1000);
  const { data } = await sb.auth.signUp({ email: `srv.${tag}.${s}@gmail.com`, password: "TestPass123!" });
  const uid = data.user.id;
  await sb.from("profiles").insert({ id: uid, username: "s" + tag + (s % 100000), display_name: "S" + tag });
  return uid;
}
(async () => {
  const A = mk(); await signup(A, "a");
  const { data: srv, error: ce } = await A.rpc("create_server", { server_name: "Smoke Server" });
  console.log("create_server:", ce ? "ERR " + ce.message : "OK id=" + srv);
  const { data: ch } = await A.from("channels").select("id,name").eq("server_id", srv);
  console.log("seeded channel:", JSON.stringify(ch));
  const chId = ch[0].id;
  const { error: msgErr } = await A.from("messages").insert({ author_id: (await A.auth.getUser()).data.user.id, channel_id: chId, content: "hi from A" });
  console.log("A posts in own server:", msgErr ? "ERR " + msgErr.message : "OK");

  // B joins from directory -> can read
  const B = mk(); const bUid = await signup(B, "b");
  const { error: jErr } = await B.from("server_members").insert({ server_id: srv, user_id: bUid });
  console.log("B joins:", jErr ? "ERR " + jErr.message : "OK");
  const { data: bRead } = await B.from("messages").select("content").eq("channel_id", chId);
  console.log("B reads after join:", JSON.stringify(bRead));

  // C never joins -> must NOT read
  const C = mk(); await signup(C, "c");
  const { data: cRead } = await C.from("channels").select("id").eq("id", chId);
  console.log("C sees channel (expect []):", JSON.stringify(cRead));
  const { data: cMsg } = await C.from("messages").select("content").eq("channel_id", chId);
  console.log("C reads messages (expect []):", JSON.stringify(cMsg));

  console.log("SMOKE_DONE");
})();
```
Run:
```bash
set -a; . ./.env.local; set +a
SB_URL="$NEXT_PUBLIC_SUPABASE_URL" SB_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" node smoke-server.cjs
rm -f smoke-server.cjs
```
Expected: `create_server: OK`; seeded channel is `general`; `A posts…: OK`; `B joins: OK`; B reads `[{"content":"hi from A"}]`; **C sees channel: `[]`** and **C reads messages: `[]`** (the RLS tightening works); `SMOKE_DONE`.

- [ ] **Step 3: Manual checklist** (`npm run dev`, http://localhost:3000, two browsers):
  - Existing login lands in "Our Server" #general; all old channels + history present; avatars/reactions/replies/pins still work.
  - Server rail: 💬 Home shows DMs (no channels); clicking a server shows its channels.
  - Create a server → lands in its #general; it appears in the rail.
  - Second browser (other user): the new server appears in the Join directory; join it → its channels load; post a message → visible to both.
  - Create a channel + a category; move a channel in via the category dropdown; collapse/expand a category.
  - Server settings: rename + upload a custom icon (initials before, image after) — reflected in the rail.
  - A user who hasn't joined a server cannot see its channels.
  - Stop the dev server when done.

- [ ] **Step 4: Merge to main.**
```bash
git checkout main
git merge feat/multi-server
git branch -d feat/multi-server
```

- [ ] **Step 5: Done.**

---

## Done Criteria

- Servers/membership/categories/per-server channels exist; channel access is membership-based (non-members can't read — verified by the smoke test).
- Rail separates servers from DMs; create/join, create channel/category, rename, and initials/custom icons all work.
- The existing server + members + channels are migrated with no loss of access.
- `npm run build` and `npm test` (39 tests) pass; backend smoke test passes; manual checklist passes; merged to `main`.
