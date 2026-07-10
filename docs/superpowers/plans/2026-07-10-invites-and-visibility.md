# Invites & public/private servers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-server public/private visibility model plus reusable invite links, so members can bring friends into private servers while public servers stay in the open directory.

**Architecture:** Two new columns on `servers` (`is_public`, `invite_code`). The `servers` SELECT RLS policy changes from wide-open to "public OR you're a member," which is what actually hides private servers. Three `SECURITY DEFINER` RPCs carry the invite flow (`server_by_invite` for the preview, `join_via_invite` to join, `regenerate_invite` for managers) so the RLS policies stay simple. A public `/invite/[code]` route renders the confirmation page.

**Tech Stack:** Next.js 16 (App Router, route groups), TypeScript, Tailwind v4, Supabase (Postgres + RLS + RPC), Vitest.

## Global Constraints

- Node is installed via nvm — source it first: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"`.
- Never expose the Supabase `service_role` key — only `anon public` (`NEXT_PUBLIC_SUPABASE_ANON_KEY`).
- All new RPCs are `SECURITY DEFINER` with `set search_path = public`, and `grant execute ... to authenticated`.
- Invite code format: `substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)` (10 hex chars).
- `server_members` PK is `(server_id, user_id)`; `is_server_admin(srv)` = owner OR admin (from `0007_roles.sql`).
- Existing servers must stay public (`is_public default true`) — no behavior change for current data.
- Follow existing component conventions: `"use client"`, `createClient()` from `@/lib/supabase/client`, Tailwind theme tokens (`bg-surface`, `text-ink`, `text-muted`, `bg-accent`, `text-danger`, etc.), dialogs as fixed-overlay + stop-propagation card.
- Migration `0008_invites.sql` must be run by the user in the Supabase SQL editor before the invite features (and the Task 6 smoke test) work against the live DB.

---

### Task 1: Types + invite URL helper

**Files:**
- Modify: `src/types/db.ts` (the `Server` type)
- Create: `src/lib/invite.ts`
- Test: `tests/invite.test.ts`

**Interfaces:**
- Produces: `Server` gains `is_public: boolean` and `invite_code: string | null`.
- Produces: `inviteUrl(code: string, origin?: string): string` — builds `${origin}/invite/${code}`; when `origin` is omitted it uses `window.location.origin` at call time.

- [ ] **Step 1: Write the failing test**

Create `tests/invite.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { inviteUrl } from "@/lib/invite";

describe("inviteUrl", () => {
  it("builds a full invite URL from an explicit origin", () => {
    expect(inviteUrl("a1b2c3d4e5", "https://chat.example.com")).toBe(
      "https://chat.example.com/invite/a1b2c3d4e5"
    );
  });

  it("does not double a trailing slash on the origin", () => {
    expect(inviteUrl("abc", "https://chat.example.com/")).toBe(
      "https://chat.example.com/invite/abc"
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; npx vitest run tests/invite.test.ts`
Expected: FAIL — cannot resolve `@/lib/invite`.

- [ ] **Step 3: Implement the helper**

Create `src/lib/invite.ts`:

```ts
/** Build the shareable invite URL for a code. Falls back to the current origin in the browser. */
export function inviteUrl(code: string, origin?: string): string {
  const base = (origin ?? (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/$/, "");
  return `${base}/invite/${code}`;
}
```

- [ ] **Step 4: Add the columns to the `Server` type**

In `src/types/db.ts`, change the `Server` type to:

```ts
export type Server = {
  id: string;
  name: string;
  icon_url: string | null;
  owner_id: string | null;
  is_public: boolean;
  invite_code: string | null;
  created_at: string;
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; npx vitest run tests/invite.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/types/db.ts src/lib/invite.ts tests/invite.test.ts
git commit -m "feat: Server visibility/invite_code types + inviteUrl helper"
```

---

### Task 2: Migration — visibility columns, RLS, and invite RPCs

**Files:**
- Create: `supabase/migrations/0008_invites.sql`

**Interfaces:**
- Produces (callable via `supabase.rpc(...)`):
  - `server_by_invite(code text)` → rows of `{ id: uuid, name: text, icon_url: text, member_count: bigint }`
  - `join_via_invite(code text)` → `uuid` (joined server id); raises on invalid code
  - `regenerate_invite(srv uuid)` → `text` (new code); raises if caller is not an admin
- Produces: `servers` now has `is_public boolean` and `invite_code text unique`; SELECT restricted to public-or-member; direct self-join restricted to public servers.

> This task has no automated test — it is DDL run manually in the Supabase SQL editor. Its behavior is verified end-to-end by the Task 6 smoke test. Verification here is a careful self-review of the SQL against the spec.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0008_invites.sql`:

```sql
-- ===== visibility + invite code columns =====
alter table public.servers add column if not exists is_public boolean not null default true;
alter table public.servers add column if not exists invite_code text unique;

-- backfill invite codes for existing servers
update public.servers
  set invite_code = substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)
  where invite_code is null;

-- ===== servers SELECT: public OR member (replaces the open "using (true)") =====
drop policy if exists "servers readable by authenticated" on public.servers;
create policy "read public or member servers" on public.servers for select to authenticated
  using (is_public or public.is_server_member(id));

-- ===== self-join tightened to PUBLIC servers only =====
drop policy if exists "self join server" on public.server_members;
create policy "self join server" on public.server_members for insert to authenticated
  with check (
    user_id = auth.uid()
    and role = 'member'
    and exists (select 1 from public.servers s where s.id = server_id and s.is_public)
  );

-- ===== create_server: set an invite code on creation =====
create or replace function public.create_server(server_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare srv uuid; cat uuid;
begin
  insert into public.servers (name, owner_id, invite_code)
    values (server_name, auth.uid(), substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
    returning id into srv;
  insert into public.server_members (server_id, user_id) values (srv, auth.uid());
  insert into public.categories (server_id, name, position) values (srv, 'Text Channels', 0) returning id into cat;
  insert into public.channels (name, position, server_id, category_id) values ('general', 0, srv, cat);
  return srv;
end $$;
grant execute on function public.create_server(text) to authenticated;

-- ===== server_by_invite: preview for non-members (definer bypasses SELECT policy) =====
create or replace function public.server_by_invite(code text)
returns table(id uuid, name text, icon_url text, member_count bigint)
language sql security definer set search_path = public as $$
  select s.id, s.name, s.icon_url,
         (select count(*) from public.server_members m where m.server_id = s.id) as member_count
  from public.servers s
  where s.invite_code = code;
$$;
grant execute on function public.server_by_invite(text) to authenticated;

-- ===== join_via_invite: join a server by code =====
create or replace function public.join_via_invite(code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare srv uuid;
begin
  select id into srv from public.servers where invite_code = code;
  if srv is null then
    raise exception 'invalid invite code';
  end if;
  insert into public.server_members (server_id, user_id, role)
    values (srv, auth.uid(), 'member')
    on conflict (server_id, user_id) do nothing;
  return srv;
end $$;
grant execute on function public.join_via_invite(text) to authenticated;

-- ===== regenerate_invite: managers roll a new code (kills the old link) =====
create or replace function public.regenerate_invite(srv uuid)
returns text language plpgsql security definer set search_path = public as $$
declare code text;
begin
  if not public.is_server_admin(srv) then
    raise exception 'not authorized';
  end if;
  code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  update public.servers set invite_code = code where id = srv;
  return code;
end $$;
grant execute on function public.regenerate_invite(uuid) to authenticated;
```

- [ ] **Step 2: Self-review the SQL against the spec**

Confirm each: columns added with `if not exists`; existing rows backfilled; open SELECT policy dropped and replaced with public-or-member; self-join now requires `is_public`; `create_server` sets `invite_code`; all three RPCs are `security definer` + `set search_path = public` + granted to `authenticated`; `regenerate_invite` checks `is_server_admin`; `join_via_invite` uses `on conflict (server_id, user_id) do nothing`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0008_invites.sql
git commit -m "feat: 0008 invites migration — visibility columns, RLS, invite RPCs"
```

---

### Task 3: Invite accept page + `?next=` plumbing

**Files:**
- Create: `src/app/invite/[code]/page.tsx`
- Modify: `src/app/login/page.tsx`
- Modify: `src/app/register/page.tsx`

**Interfaces:**
- Consumes: `server_by_invite(code)`, `join_via_invite(code)` (Task 2); `inviteUrl` not needed here; `useAuth()` → `{ user, loading }`.
- Produces: a public route at `/invite/<code>`; login/register redirect to a `?next=` target after auth.

- [ ] **Step 1: Add `?next=` handling to login**

In `src/app/login/page.tsx`, add the import and read the param, then redirect to it. Replace the imports and the `onSubmit` success redirect:

Change the top imports to:

```tsx
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
```

Inside `LoginPage`, after `const router = useRouter();` add:

```tsx
  const params = useSearchParams();
  const next = params.get("next") || "/channels/first";
```

Change the success line `router.push("/channels/first");` to:

```tsx
    router.push(next);
```

- [ ] **Step 2: Add `?next=` handling to register (and carry it to the login link)**

In `src/app/register/page.tsx`, change the top imports to:

```tsx
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { validateUsername } from "@/lib/validation";
```

After `const router = useRouter();` add:

```tsx
  const params = useSearchParams();
  const next = params.get("next") || "/channels/first";
```

Change the success line `router.push("/channels/first");` to:

```tsx
    router.push(next);
```

Change the "Log in" link so it carries `next` through:

```tsx
        <p className="text-sm text-muted">
          Have an account? <Link href={`/login?next=${encodeURIComponent(next)}`} className="text-accent">Log in</Link>
        </p>
```

- [ ] **Step 3: Create the invite accept page**

Create `src/app/invite/[code]/page.tsx`:

```tsx
"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { ServerIcon } from "@/components/servers/ServerIcon";

type Preview = { id: string; name: string; icon_url: string | null; member_count: number };

export default function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const supabase = createClient();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [preview, setPreview] = useState<Preview | null>(null);
  const [isMember, setIsMember] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace(`/login?next=/invite/${code}`);
      return;
    }
    (async () => {
      const { data, error: err } = await supabase.rpc("server_by_invite", { code });
      const row = (data as Preview[] | null)?.[0] ?? null;
      if (err || !row) {
        setError("This invite is invalid or expired.");
        setLoading(false);
        return;
      }
      setPreview(row);
      const { data: mem } = await supabase
        .from("server_members")
        .select("server_id")
        .eq("server_id", row.id)
        .eq("user_id", user.id)
        .maybeSingle();
      setIsMember(!!mem);
      setLoading(false);
    })();
  }, [authLoading, user, code, supabase, router]);

  async function join() {
    setBusy(true);
    setError(null);
    if (isMember && preview) {
      router.replace(`/channels/first?server=${preview.id}`);
      return;
    }
    const { data, error: err } = await supabase.rpc("join_via_invite", { code });
    if (err || !data) {
      setBusy(false);
      return setError("Couldn't join — the invite may be invalid.");
    }
    router.replace(`/channels/first?server=${data}`);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-surface border border-line p-6 rounded-xl text-center">
        {loading ? (
          <p className="text-muted">Loading invite…</p>
        ) : error ? (
          <p className="text-danger">{error}</p>
        ) : preview ? (
          <>
            <div className="flex justify-center mb-3">
              <ServerIcon iconUrl={preview.icon_url} name={preview.name} size="lg" />
            </div>
            <h1 className="text-lg font-bold text-ink">{preview.name}</h1>
            <p className="text-sm text-muted mb-4">
              {preview.member_count} {preview.member_count === 1 ? "member" : "members"}
            </p>
            <button onClick={join} disabled={busy}
              className="w-full bg-accent hover:bg-accent-strong text-white font-medium rounded-lg p-2 disabled:opacity-50">
              {busy ? "…" : isMember ? "Open" : "Join Server"}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify the build compiles**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; npm run build`
Expected: build succeeds; route list includes `/invite/[code]`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/invite/[code]/page.tsx" src/app/login/page.tsx src/app/register/page.tsx
git commit -m "feat: invite accept page + next-redirect through login/register"
```

---

### Task 4: InviteDialog + server-header entry point

**Files:**
- Create: `src/components/servers/InviteDialog.tsx`
- Modify: `src/components/servers/ServerSidebar.tsx`

**Interfaces:**
- Consumes: `inviteUrl` (Task 1), `regenerate_invite` RPC (Task 2), `Server` type with `invite_code`.
- Produces: `<InviteDialog server={Server} isManager={boolean} onClose={() => void} />` — any member sees the link + Copy; managers also get Regenerate.

- [ ] **Step 1: Create the InviteDialog**

Create `src/components/servers/InviteDialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { inviteUrl } from "@/lib/invite";
import type { Server } from "@/types/db";

export function InviteDialog({
  server,
  isManager,
  onClose,
}: {
  server: Server;
  isManager: boolean;
  onClose: () => void;
}) {
  const supabase = createClient();
  const [code, setCode] = useState<string | null>(server.invite_code);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = code ? inviteUrl(code) : "";

  async function copy() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function regenerate() {
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("regenerate_invite", { srv: server.id });
    setBusy(false);
    if (err || !data) return setError("Couldn't regenerate — try again");
    setCode(data as string);
    setCopied(false);
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface p-5 rounded-xl w-96 border border-line" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-ink font-semibold mb-1">Invite people to {server.name}</h2>
        <p className="text-muted text-xs mb-3">Anyone with this link can join.</p>
        {error && <p className="text-danger text-sm mb-2">{error}</p>}
        <div className="flex gap-2">
          <input readOnly value={url} className="flex-1 p-2 rounded-lg bg-surface-2 text-ink text-sm" />
          <button onClick={copy}
            className="text-sm bg-accent hover:bg-accent-strong text-white rounded-lg px-3 disabled:opacity-50">
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        {isManager && (
          <button onClick={regenerate} disabled={busy}
            className="text-xs text-muted mt-3 hover:text-ink disabled:opacity-50">
            {busy ? "Regenerating…" : "Regenerate link (invalidates the old one)"}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the server sidebar header**

In `src/components/servers/ServerSidebar.tsx`:

Add the import after the `ServerSettingsDialog` import:

```tsx
import { InviteDialog } from "@/components/servers/InviteDialog";
```

Add an `inviting` state after `const [settings, setSettings] = useState(false);`:

```tsx
  const [inviting, setInviting] = useState(false);
```

Replace the header button block (the `<button onClick={() => setSettings(true)} ...>` element) with a row that keeps the settings button and adds an invite button:

```tsx
      <div className="flex items-center border-b border-line">
        <button
          onClick={() => setSettings(true)}
          className="flex-1 p-3 font-bold text-ink flex items-center justify-between hover:bg-surface min-w-0"
        >
          <span className="truncate">{server?.name ?? "…"}</span>
          <span className="text-muted text-sm">⚙</span>
        </button>
        <button
          onClick={() => setInviting(true)}
          title="Invite people"
          className="px-3 py-3 text-muted hover:text-ink hover:bg-surface"
        >
          ＋
        </button>
      </div>
```

Add the dialog render next to the existing `{settings && ...}` block:

```tsx
      {inviting && server && (
        <InviteDialog server={server} isManager={isManager} onClose={() => setInviting(false)} />
      )}
```

- [ ] **Step 3: Verify the build compiles**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/servers/InviteDialog.tsx src/components/servers/ServerSidebar.tsx
git commit -m "feat: invite dialog with copy + manager regenerate, wired to server header"
```

---

### Task 5: Public/Private toggle + directory relabel

**Files:**
- Modify: `src/components/servers/ServerSettingsDialog.tsx`
- Modify: `src/components/servers/AddServerDialog.tsx`

**Interfaces:**
- Consumes: `Server.is_public` (Task 1), existing `admins update server` UPDATE policy.
- Produces: managers can flip a server between public and private; the Join tab is labeled "Public servers".

- [ ] **Step 1: Add the visibility toggle to ServerSettingsDialog**

In `src/components/servers/ServerSettingsDialog.tsx`, add a local state for the flag after `const [name, setName] = useState(server.name);`:

```tsx
  const [isPublic, setIsPublic] = useState(server.is_public);
```

Add a `toggleVisibility` function after `saveName`:

```tsx
  async function toggleVisibility() {
    const next = !isPublic;
    setIsPublic(next);
    setBusy(true);
    const { error: err } = await supabase.from("servers").update({ is_public: next }).eq("id", server.id);
    setBusy(false);
    if (err) {
      setIsPublic(!next);
      return setError("Couldn't change visibility — try again");
    }
    onSaved();
  }
```

Inside the `{isManager && (<> ... </>)}` block, add the toggle right after the Save button (before the closing `</>`):

```tsx
            <div className="flex items-center justify-between mt-4">
              <div>
                <p className="text-ink text-sm">{isPublic ? "Public" : "Private"}</p>
                <p className="text-muted text-xs">
                  {isPublic ? "Listed in the directory; anyone can join." : "Hidden; join by invite link only."}
                </p>
              </div>
              <button onClick={toggleVisibility} disabled={busy}
                className="text-sm bg-surface-2 hover:bg-line text-ink rounded-lg px-3 py-1.5 disabled:opacity-50">
                Make {isPublic ? "private" : "public"}
              </button>
            </div>
```

- [ ] **Step 2: Relabel the directory Join tab**

In `src/components/servers/AddServerDialog.tsx`, the Join tab lists servers the SELECT policy now limits to public ones. Add a small heading above the list so it reads honestly. Replace the `<ul ...>` opening with a wrapping fragment that includes a heading:

Change:

```tsx
          <ul className="max-h-72 overflow-y-auto flex flex-col gap-1">
```

to:

```tsx
          <>
          <p className="text-muted text-xs mb-2">Public servers</p>
          <ul className="max-h-72 overflow-y-auto flex flex-col gap-1">
```

And change the matching close `</ul>` (just before the closing `)}` of the ternary) to:

```tsx
          </ul>
          </>
```

- [ ] **Step 3: Verify the build compiles**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/servers/ServerSettingsDialog.tsx src/components/servers/AddServerDialog.tsx
git commit -m "feat: public/private toggle in server settings; label directory as public"
```

---

### Task 6: Backend smoke test (RLS + RPC verification)

**Files:**
- Create: `scratchpad/invite-smoke.mjs` (throwaway — not committed)

**Interfaces:**
- Consumes: live Supabase project, everything from Tasks 1–5.

> **Prerequisite:** the user must have run `0008_invites.sql` in the Supabase SQL editor. This task runs in-session (needs live DB + `.env.local`). It creates throwaway users; those are harmless and deletable.

- [ ] **Step 1: Write the smoke test**

Create `scratchpad/invite-smoke.mjs` (read `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` from `.env.local`):

```js
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n").filter(Boolean).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  })
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const mk = () => createClient(URL, KEY);

function stamp() {
  // no Math.random / Date.now needed — use a monotonic-ish suffix from performance
  return Math.floor(performance.now() * 1000).toString(36);
}
const ok = (m) => console.log("OK:", m);
const bad = (m) => { console.error("FAIL:", m); process.exitCode = 1; };

async function newUser(tag) {
  const c = mk();
  const email = `smoke_${tag}_${stamp()}@example.com`;
  const { data, error } = await c.auth.signUp({ email, password: "password123" });
  if (error) throw new Error(`signup ${tag}: ${error.message}`);
  await c.from("profiles").insert({ id: data.user.id, username: `sm_${tag}_${stamp()}`, display_name: tag });
  return { c, id: data.user.id };
}

const owner = await newUser("owner");
const outsider = await newUser("out");

// owner creates a server, makes it private
const { data: srv, error: cErr } = await owner.c.rpc("create_server", { server_name: "Smoke Private" });
if (cErr) throw new Error("create_server: " + cErr.message);
await owner.c.from("servers").update({ is_public: false }).eq("id", srv);
const { data: srvRow } = await owner.c.from("servers").select("invite_code").eq("id", srv).single();
const code = srvRow.invite_code;

// 1. outsider cannot SELECT the private server row
{
  const { data } = await outsider.c.from("servers").select("id").eq("id", srv);
  (data && data.length === 0) ? ok("outsider cannot see private server row") : bad("outsider SAW private server");
}
// 2. outsider CAN read it via server_by_invite
{
  const { data } = await outsider.c.rpc("server_by_invite", { code });
  (data && data[0] && data[0].id === srv) ? ok("outsider reads server_by_invite") : bad("server_by_invite hid the server");
}
// 3. direct self-join to a private server is blocked
{
  const { error } = await outsider.c.from("server_members").insert({ server_id: srv, user_id: outsider.id, role: "member" });
  error ? ok("direct self-join to private blocked") : bad("outsider self-joined a private server");
}
// 4a. join_via_invite works with a valid code
{
  const { data, error } = await outsider.c.rpc("join_via_invite", { code });
  (!error && data === srv) ? ok("join_via_invite with valid code works") : bad("join_via_invite failed: " + (error?.message ?? "no id"));
}
// 4b. invalid code errors
{
  const { error } = await outsider.c.rpc("join_via_invite", { code: "deadbeef00" });
  error ? ok("join_via_invite with bad code errors") : bad("bad code did not error");
}
// 5. regenerate_invite: member fails, admin succeeds, old code dies
{
  const { error } = await outsider.c.rpc("regenerate_invite", { srv }); // outsider is now a plain member
  error ? ok("member cannot regenerate invite") : bad("member regenerated invite");

  const { data: fresh, error: aErr } = await owner.c.rpc("regenerate_invite", { srv });
  (!aErr && typeof fresh === "string" && fresh !== code) ? ok("owner regenerated invite") : bad("owner regenerate failed");

  const outsider2 = await newUser("out2");
  const { data: byOld } = await outsider2.c.rpc("server_by_invite", { code });
  (byOld && byOld.length === 0) ? ok("old invite code stops working") : bad("old code still resolves");
}
// 6. public directory-join still works
{
  const { data: pub } = await owner.c.rpc("create_server", { server_name: "Smoke Public" });
  const joiner = await newUser("join");
  const { error } = await joiner.c.from("server_members").insert({ server_id: pub, user_id: joiner.id, role: "member" });
  error ? bad("public directory-join blocked: " + error.message) : ok("public directory-join works");
}
console.log(process.exitCode ? "\nSMOKE FAILED" : "\nSMOKE PASSED");
```

- [ ] **Step 2: Run the smoke test**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; node scratchpad/invite-smoke.mjs`
Expected: every line prints `OK: …` and the final line is `SMOKE PASSED`.

- [ ] **Step 3: No commit**

The smoke script lives in `scratchpad/` and is not committed (matches prior slices' throwaway verification).

---

## Notes for the executor

- After all tasks: run the full suite once — `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; npx vitest run` (expect all prior tests + the 2 new invite tests) and `npm run build`.
- Remind the user to run `0008_invites.sql` in the Supabase SQL editor before the live manual test and before Task 6.
- Manual test to suggest to the user: create a server → open the ＋ invite dialog → copy the link → make the server private in settings → confirm it disappears from another account's directory → paste the invite link in the other account and Join.
