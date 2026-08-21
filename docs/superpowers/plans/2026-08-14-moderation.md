# Moderation (kick / ban / timeout) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server moderation — kick, ban (with rejoin-block + unban), and timeout (block sending messages + reactions for a preset duration) — gated by three permissions and role hierarchy, enforced in the database.

**Architecture:** One migration adds a `bans` table, a `server_members.timeout_until` column, helper predicates, and five SECURITY DEFINER RPCs that enforce permission + hierarchy atomically; RLS independently blocks banned rejoin and timed-out posting. A pure `canModerate` helper mirrors the DB rule so the UI only offers allowed actions. UI: a per-member `⋯` menu in the Members panel, a Banned list in Server Settings, and a timed-out notice in the composer.

**Tech Stack:** Next.js 16 (App Router, client components), TypeScript, Tailwind v4, Supabase (Postgres RLS + SECURITY DEFINER RPCs), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-14-moderation-design.md`

## Global Constraints

- **One migration** `supabase/migrations/0018_moderation.sql`, exactly as in Task 3. No other schema change.
- **Three permissions:** existing `kick_members`, new `ban_members`, `timeout_members`.
- **Owner** (`servers.owner_id`) may always act; **hierarchy:** a non-owner may act only on a member whose top role rank is **strictly below** theirs, **never** the owner or themselves. Rank floor for a roleless member is **-1** (SQL uses `coalesce(max(position), -1)`; client coalesces `null → -1`).
- Mutations go **only** through the RPCs (they enforce permission+hierarchy; `bans` has no client write policy). RLS is the independent backstop for rejoin + posting.
- **Timeout presets:** 5 min, 10 min, 1 hour, 1 day, 1 week; blocks messages **and** reactions; server-scoped (DMs unaffected).
- No message-deletion on ban; optional ban reason; no custom timeout duration.
- Reuse existing idioms: popover with outside-click+Escape (as in `MessageActions`/`MessageInput`); dialog overlay `fixed inset-0 bg-black/60 … z-50`; tokens `bg-surface`, `bg-surface-2`, `border-line`, `text-ink`, `text-muted`, `text-danger`, `bg-accent`.

---

### Task 1: Permissions + types

**Files:**
- Modify: `src/lib/permissions.ts`
- Modify: `src/types/db.ts`

**Interfaces:**
- Produces: `PERMISSIONS` includes `"ban_members"`, `"timeout_members"`; `PERMISSION_LABELS` has their labels; `Ban` type; `Member`/membership gains `timeout_until`.

- [ ] **Step 1: Extend permissions**

In `src/lib/permissions.ts`, update the array and labels:

```ts
export const PERMISSIONS = [
  "manage_channels", "manage_server", "manage_roles",
  "kick_members", "ban_members", "timeout_members", "manage_messages",
] as const;
```
Add to `PERMISSION_LABELS`:
```ts
  ban_members: "Ban Members",
  timeout_members: "Timeout Members",
```

- [ ] **Step 2: Add the `Ban` type to `src/types/db.ts`**

```ts
export type Ban = {
  server_id: string;
  user_id: string;
  banned_by: string | null;
  reason: string | null;
  created_at: string;
};
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -vE "tests/"`
Expected: no new app-code errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/permissions.ts src/types/db.ts
git commit -m "feat: ban_members + timeout_members permissions; Ban type"
```

---

### Task 2: `canModerate` pure helper + timeout presets (TDD)

**Files:**
- Create: `src/lib/moderation.ts`
- Test: `tests/moderation.test.ts`

**Interfaces:**
- Produces:
  - `canModerate(o: ModerationCheck): boolean` where `ModerationCheck = { isOwner: boolean; hasPerm: boolean; viewerRank: number; targetRank: number; targetIsOwner: boolean; targetIsSelf: boolean }`
  - `TIMEOUT_PRESETS: { label: string; ms: number }[]`

- [ ] **Step 1: Write the failing tests**

Create `tests/moderation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { canModerate, TIMEOUT_PRESETS } from "@/lib/moderation";

const base = { isOwner: false, hasPerm: true, viewerRank: 5, targetRank: 2, targetIsOwner: false, targetIsSelf: false };

describe("canModerate", () => {
  it("permitted mod acts on a strictly-lower rank", () => {
    expect(canModerate(base)).toBe(true);
  });
  it("blocks equal rank", () => {
    expect(canModerate({ ...base, targetRank: 5 })).toBe(false);
  });
  it("blocks higher rank", () => {
    expect(canModerate({ ...base, targetRank: 9 })).toBe(false);
  });
  it("blocks self even with permission", () => {
    expect(canModerate({ ...base, targetIsSelf: true })).toBe(false);
  });
  it("blocks acting on the owner even for the owner", () => {
    expect(canModerate({ ...base, isOwner: true, targetIsOwner: true })).toBe(false);
  });
  it("owner may act on a lower member without the explicit permission", () => {
    expect(canModerate({ ...base, isOwner: true, hasPerm: false })).toBe(true);
  });
  it("non-owner without the permission is blocked", () => {
    expect(canModerate({ ...base, hasPerm: false })).toBe(false);
  });
  it("roleless non-owner (rank -1) cannot act on a roleless target (rank -1)", () => {
    expect(canModerate({ ...base, viewerRank: -1, targetRank: -1 })).toBe(false);
  });
  it("exposes the five timeout presets in ascending order", () => {
    expect(TIMEOUT_PRESETS.map((p) => p.label)).toEqual(["5 min", "10 min", "1 hour", "1 day", "1 week"]);
    expect(TIMEOUT_PRESETS[0].ms).toBe(5 * 60_000);
    expect(TIMEOUT_PRESETS[4].ms).toBe(7 * 24 * 60 * 60_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/moderation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/moderation.ts`:

```ts
export type ModerationCheck = {
  isOwner: boolean;
  hasPerm: boolean;
  viewerRank: number; // caller coalesces a null rank to -1
  targetRank: number; // caller coalesces a null rank to -1
  targetIsOwner: boolean;
  targetIsSelf: boolean;
};

/** Mirrors the DB `can_moderate`: never self/owner; owner always may; else needs the
 *  permission AND a strictly-higher role rank than the target. */
export function canModerate(o: ModerationCheck): boolean {
  if (o.targetIsSelf || o.targetIsOwner) return false;
  if (o.isOwner) return true;
  return o.hasPerm && o.viewerRank > o.targetRank;
}

export const TIMEOUT_PRESETS: { label: string; ms: number }[] = [
  { label: "5 min", ms: 5 * 60_000 },
  { label: "10 min", ms: 10 * 60_000 },
  { label: "1 hour", ms: 60 * 60_000 },
  { label: "1 day", ms: 24 * 60 * 60_000 },
  { label: "1 week", ms: 7 * 24 * 60 * 60_000 },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/moderation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/moderation.ts tests/moderation.test.ts
git commit -m "feat: canModerate helper + timeout presets (TDD)"
```

---

### Task 3: Migration `0018_moderation.sql`

**Files:**
- Create: `supabase/migrations/0018_moderation.sql`

**Interfaces:**
- Produces: `bans` table; `server_members.timeout_until`; helpers `is_banned`, `is_timed_out`, `is_timed_out_channel`, `is_timed_out_message`, `server_role_rank`, `can_moderate`; updated `my_permissions`; RPCs `kick_member`, `ban_member`, `unban_member`, `timeout_member`; RLS changes.

This task WRITES the file only. The controller diffs it verbatim against this plan and applies it (`supabase db push`) before manual verification (Task 7). Do NOT run any db command.

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/0018_moderation.sql`:

```sql
-- Moderation: kick / ban / timeout. Widens role permissions, adds bans + timeout,
-- helper predicates, and SECURITY DEFINER mutation RPCs enforcing permission + hierarchy.

-- 1. Widen the roles permission allowlist (superset of 0012).
alter table public.roles drop constraint if exists roles_valid_permissions;
alter table public.roles add constraint roles_valid_permissions check (
  permissions <@ array['manage_channels','manage_server','manage_roles',
    'kick_members','ban_members','timeout_members','manage_messages']::text[]
);

-- 2. Owner's effective permissions must include the two new ones (0014 hardcoded five).
create or replace function public.my_permissions(srv uuid)
returns text[] language sql security definer set search_path = public stable as $$
  select case
    when exists (select 1 from public.servers s where s.id = srv and s.owner_id = auth.uid())
      then array['manage_channels','manage_server','manage_roles',
                 'kick_members','ban_members','timeout_members','manage_messages']::text[]
    else coalesce((
      select array_agg(distinct p)
      from public.member_roles mr
      join public.roles r on r.id = mr.role_id
      cross join lateral unnest(r.permissions) as p
      where mr.server_id = srv and mr.user_id = auth.uid()
    ), array[]::text[])
  end;
$$;

-- 3. Timeout column on membership.
alter table public.server_members add column if not exists timeout_until timestamptz;

-- 4. Bans table.
create table if not exists public.bans (
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  banned_by uuid references public.profiles(id),
  reason    text,
  created_at timestamptz not null default now(),
  primary key (server_id, user_id)
);
alter table public.bans enable row level security;

-- 5. Predicate helpers (SECURITY DEFINER).
create or replace function public.is_banned(srv uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.bans where server_id = srv and user_id = auth.uid());
$$;
grant execute on function public.is_banned(uuid) to authenticated;

create or replace function public.is_timed_out(srv uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.server_members
    where server_id = srv and user_id = auth.uid()
      and timeout_until is not null and timeout_until > now()
  );
$$;
grant execute on function public.is_timed_out(uuid) to authenticated;

create or replace function public.is_timed_out_channel(chan uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select public.is_timed_out((select server_id from public.channels where id = chan));
$$;
grant execute on function public.is_timed_out_channel(uuid) to authenticated;

create or replace function public.is_timed_out_message(msg uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select public.is_timed_out((
    select c.server_id from public.messages m
    join public.channels c on c.id = m.channel_id
    where m.id = msg
  ));
$$;
grant execute on function public.is_timed_out_message(uuid) to authenticated;
-- Note: is_timed_out(null) → the inner exists() is false, so DM messages (no channel) are never timed out.

-- 6. Hierarchy: target's top role rank (roleless → -1), and the moderation gate.
create or replace function public.server_role_rank(srv uuid, uid uuid)
returns int language sql security definer set search_path = public stable as $$
  select coalesce(max(r.position), -1)
  from public.member_roles mr
  join public.roles r on r.id = mr.role_id
  where mr.server_id = srv and mr.user_id = uid;
$$;
grant execute on function public.server_role_rank(uuid, uuid) to authenticated;

create or replace function public.can_moderate(srv uuid, target uuid, perm text)
returns boolean language sql security definer set search_path = public stable as $$
  select
    target <> auth.uid()
    and target <> coalesce((select owner_id from public.servers where id = srv), '00000000-0000-0000-0000-000000000000'::uuid)
    and (
      exists (select 1 from public.servers s where s.id = srv and s.owner_id = auth.uid())
      or (
        public.has_server_permission(srv, perm)
        and public.server_role_rank(srv, auth.uid()) > public.server_role_rank(srv, target)
      )
    );
$$;
grant execute on function public.can_moderate(uuid, uuid, text) to authenticated;

-- 7. Mutation RPCs (enforce permission + hierarchy; raise on violation).
create or replace function public.kick_member(srv uuid, target uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_moderate(srv, target, 'kick_members') then
    raise exception 'not permitted';
  end if;
  delete from public.server_members where server_id = srv and user_id = target;
end;
$$;
grant execute on function public.kick_member(uuid, uuid) to authenticated;

create or replace function public.ban_member(srv uuid, target uuid, reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_moderate(srv, target, 'ban_members') then
    raise exception 'not permitted';
  end if;
  insert into public.bans (server_id, user_id, banned_by, reason)
    values (srv, target, auth.uid(), reason)
    on conflict (server_id, user_id) do update
      set reason = excluded.reason, banned_by = excluded.banned_by;
  delete from public.server_members where server_id = srv and user_id = target;
end;
$$;
grant execute on function public.ban_member(uuid, uuid, text) to authenticated;

create or replace function public.unban_member(srv uuid, target uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (
    exists (select 1 from public.servers s where s.id = srv and s.owner_id = auth.uid())
    or public.has_server_permission(srv, 'ban_members')
  ) then
    raise exception 'not permitted';
  end if;
  delete from public.bans where server_id = srv and user_id = target;
end;
$$;
grant execute on function public.unban_member(uuid, uuid) to authenticated;

create or replace function public.timeout_member(srv uuid, target uuid, until timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_moderate(srv, target, 'timeout_members') then
    raise exception 'not permitted';
  end if;
  update public.server_members set timeout_until = until
    where server_id = srv and user_id = target;
end;
$$;
grant execute on function public.timeout_member(uuid, uuid, timestamptz) to authenticated;

-- 8. RLS: block rejoin while banned.
drop policy if exists "self join server" on public.server_members;
create policy "self join server" on public.server_members for insert to authenticated
  with check (user_id = auth.uid() and not public.is_banned(server_id));

-- 9. RLS: timed-out users can't send messages (channels only; DMs unaffected).
drop policy if exists "send messages" on public.messages;
create policy "send messages" on public.messages for insert to authenticated
  with check (
    author_id = auth.uid() and (
      (channel_id is not null and public.is_channel_member(channel_id)
        and not public.is_timed_out_channel(channel_id))
      or (conversation_id is not null and public.is_conversation_member(conversation_id))
    )
  );

-- 10. RLS: timed-out users can't add reactions.
drop policy if exists "add own reactions" on public.reactions;
create policy "add own reactions" on public.reactions for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.can_read_message(message_id)
    and not public.is_timed_out_message(message_id)
  );

-- 11. RLS: bans readable by ban_members holders / owner (for the Banned list).
create policy "read bans (ban_members)" on public.bans for select to authenticated
  using (
    public.has_server_permission(server_id, 'ban_members')
    or server_id in (select id from public.servers where owner_id = auth.uid())
  );
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0018_moderation.sql
git commit -m "feat: moderation migration — bans, timeout, RPCs, RLS (0018)"
```

---

### Task 4: Member moderation menu + Members panel wiring

**Files:**
- Create: `src/components/servers/MemberModMenu.tsx`
- Modify: `src/components/servers/MembersPanel.tsx`

**Interfaces:**
- Consumes: `canModerate`, `TIMEOUT_PRESETS` (Task 2); `useServerPermissions` → `{ has, isOwner, rank }`; `useMemberRoleColors` → `{ colorFor, rolesFor }`; `useAuth` → `{ user }`; RPCs `kick_member`/`ban_member`/`timeout_member`.
- Produces: `MemberModMenu` component.

- [ ] **Step 1: Create `MemberModMenu`**

Create `src/components/servers/MemberModMenu.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { TIMEOUT_PRESETS } from "@/lib/moderation";
import { DotsThree, Clock, Prohibit, UserMinus } from "@phosphor-icons/react";

export function MemberModMenu({
  serverId, targetId, targetName, timedOut, canKick, canBan, canTimeout, onDone,
}: {
  serverId: string;
  targetId: string;
  targetName: string;
  timedOut: boolean;
  canKick: boolean;
  canBan: boolean;
  canTimeout: boolean;
  onDone: () => void;
}) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [banning, setBanning] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setBanning(false); } }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") { setOpen(false); setBanning(false); } }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  async function run(fn: () => Promise<{ error: unknown }>) {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    setOpen(false);
    setBanning(false);
    if (!error) onDone();
  }

  function timeoutFor(ms: number) {
    return run(() => supabase.rpc("timeout_member", { srv: serverId, target: targetId, until: new Date(Date.now() + ms).toISOString() }));
  }
  function clearTimeout_() {
    return run(() => supabase.rpc("timeout_member", { srv: serverId, target: targetId, until: null }));
  }
  function kick() {
    if (!confirm(`Kick ${targetName}? They can rejoin with an invite.`)) return;
    return run(() => supabase.rpc("kick_member", { srv: serverId, target: targetId }));
  }
  function ban() {
    return run(() => supabase.rpc("ban_member", { srv: serverId, target: targetId, reason: reason.trim() || null }));
  }

  if (!canKick && !canBan && !canTimeout) return null;

  return (
    <div className="relative flex-none" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} title="Moderate" aria-label="Moderate"
        className="text-muted hover:text-ink flex-none">
        <DotsThree size={18} weight="bold" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-44 rounded-xl border border-line bg-surface shadow-lg py-1 text-sm">
          {banning ? (
            <div className="px-3 py-2">
              <p className="text-ink mb-1">Ban {targetName}?</p>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)"
                className="w-full p-1.5 rounded-lg bg-surface-2 text-ink text-xs mb-2" />
              <div className="flex gap-2">
                <button disabled={busy} onClick={ban} className="flex-1 bg-danger/90 hover:bg-danger text-white rounded-lg py-1 disabled:opacity-50">Ban</button>
                <button onClick={() => setBanning(false)} className="flex-1 bg-surface-2 hover:bg-line text-ink rounded-lg py-1">Cancel</button>
              </div>
            </div>
          ) : (
            <>
              {canTimeout && (
                <>
                  <div className="px-3 pt-1 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted flex items-center gap-1"><Clock size={12} /> Timeout</div>
                  {TIMEOUT_PRESETS.map((p) => (
                    <button key={p.label} disabled={busy} onClick={() => timeoutFor(p.ms)}
                      className="w-full px-4 py-1 text-left text-ink hover:bg-surface-2 disabled:opacity-50">{p.label}</button>
                  ))}
                  {timedOut && (
                    <button disabled={busy} onClick={clearTimeout_}
                      className="w-full px-4 py-1 text-left text-ink hover:bg-surface-2 disabled:opacity-50">Remove timeout</button>
                  )}
                </>
              )}
              {canKick && (
                <button disabled={busy} onClick={kick}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-ink hover:bg-surface-2 disabled:opacity-50"><UserMinus size={15} /> Kick</button>
              )}
              {canBan && (
                <button disabled={busy} onClick={() => setBanning(true)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-danger hover:bg-surface-2 disabled:opacity-50"><Prohibit size={15} /> Ban</button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire `MembersPanel`**

Edit `src/components/servers/MembersPanel.tsx`:

- Add imports:
```tsx
import { useAuth } from "@/components/providers/AuthProvider";
import { canModerate } from "@/lib/moderation";
import { MemberModMenu } from "@/components/servers/MemberModMenu";
import { Clock } from "@phosphor-icons/react";
```
- Change the member type + query to carry `timeout_until`, and add owner tracking:
```tsx
type Member = { user_id: string; timeout_until: string | null; profile: Profile | null };
```
  In the `load` query, select it and (once) the owner id:
```tsx
    const { data: rows } = await supabase.from("server_members").select("user_id, timeout_until, profiles(*)").eq("server_id", serverId);
    setMembers(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rows ?? []).map((r: any) => ({ user_id: r.user_id, timeout_until: r.timeout_until, profile: r.profiles }))
    );
```
- Add hooks/state near the top of the component:
```tsx
  const { user } = useAuth();
  const { has, isOwner, rank } = useServerPermissions(serverId);
  const { colorFor, rolesFor } = useMemberRoleColors(serverId);
  const [ownerId, setOwnerId] = useState<string | null>(null);
```
  Fetch the owner id once:
```tsx
  useEffect(() => {
    supabase.from("servers").select("owner_id").eq("id", serverId).single()
      .then(({ data }) => setOwnerId((data as { owner_id: string | null } | null)?.owner_id ?? null));
  }, [supabase, serverId]);
```
- Inside `members.map`, before the `manage_roles` button, compute gating and render the menu + timeout glyph:
```tsx
              {(() => {
                const targetRank = rolesFor(m.user_id).reduce((mx, r) => Math.max(mx, r.position), -1);
                const ctx = {
                  isOwner, viewerRank: rank ?? -1, targetRank,
                  targetIsOwner: m.user_id === ownerId, targetIsSelf: m.user_id === user?.id,
                };
                const timedOut = !!m.timeout_until && new Date(m.timeout_until) > new Date();
                return (
                  <>
                    {timedOut && (
                      <span className="text-muted flex-none" title={`Timed out until ${new Date(m.timeout_until!).toLocaleString()}`}>
                        <Clock size={14} weight="fill" />
                      </span>
                    )}
                    <MemberModMenu
                      serverId={serverId}
                      targetId={m.user_id}
                      targetName={m.profile?.display_name ?? "member"}
                      timedOut={timedOut}
                      canKick={canModerate({ ...ctx, hasPerm: has("kick_members") })}
                      canBan={canModerate({ ...ctx, hasPerm: has("ban_members") })}
                      canTimeout={canModerate({ ...ctx, hasPerm: has("timeout_members") })}
                      onDone={load}
                    />
                  </>
                );
              })()}
```
(Keep the existing `manage_roles` ShieldStar button as-is.)

- [ ] **Step 3: Typecheck + build**

Run: `npm run build`
Expected: succeeds. (If `DotsThree`/`Clock`/`Prohibit`/`UserMinus` names mis-resolve, confirm spelling — all are exported by `@phosphor-icons/react`.)

- [ ] **Step 4: Commit**

```bash
git add src/components/servers/MemberModMenu.tsx src/components/servers/MembersPanel.tsx
git commit -m "feat: per-member moderation menu (kick/ban/timeout) in Members panel"
```

---

### Task 5: Banned list in Server Settings

**Files:**
- Modify: `src/components/servers/ServerSettingsDialog.tsx`

**Interfaces:**
- Consumes: `useServerPermissions` → `{ has, isOwner }`; RPC `unban_member`; the `bans` SELECT policy.

- [ ] **Step 1: Add a Banned section**

In `src/components/servers/ServerSettingsDialog.tsx`:
- Add imports (if not present): `useEffect`, `useServerPermissions`, `Avatar`.
- Add state + loader (place near the component's other hooks):
```tsx
  const { has, isOwner } = useServerPermissions(server.id);
  const canBan = isOwner || has("ban_members");
  const [bans, setBans] = useState<{ user_id: string; reason: string | null; profile: { display_name: string | null; avatar_url: string | null } | null }[]>([]);

  const loadBans = useCallback(async () => {
    if (!canBan) return;
    const { data } = await supabase.from("bans").select("user_id, reason, profiles(display_name, avatar_url)").eq("server_id", server.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setBans((data ?? []).map((b: any) => ({ user_id: b.user_id, reason: b.reason, profile: b.profiles })));
  }, [supabase, server.id, canBan]);

  useEffect(() => { loadBans(); }, [loadBans]);

  async function unban(userId: string) {
    await supabase.rpc("unban_member", { srv: server.id, target: userId });
    loadBans();
  }
```
  (If `useCallback`/`useEffect`/`useState` aren't imported, add them.)
- Render the section inside the dialog body (e.g. after the roles button, before "Leave server"):
```tsx
        {canBan && bans.length > 0 && (
          <div className="mt-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">Banned</div>
            <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
              {bans.map((b) => (
                <div key={b.user_id} className="flex items-center gap-2 text-sm">
                  <Avatar url={b.profile?.avatar_url ?? null} name={b.profile?.display_name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="text-ink truncate">{b.profile?.display_name ?? "Unknown"}</div>
                    {b.reason && <div className="text-muted text-xs truncate">{b.reason}</div>}
                  </div>
                  <button onClick={() => unban(b.user_id)} className="text-accent text-xs hover:underline flex-none">Unban</button>
                </div>
              ))}
            </div>
          </div>
        )}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/servers/ServerSettingsDialog.tsx
git commit -m "feat: Banned list + Unban in Server Settings"
```

---

### Task 6: Composer own-timeout notice

**Files:**
- Modify: `src/components/messages/MessageInput.tsx`

**Interfaces:**
- Consumes: the message `target` (already a prop) to resolve the server; the caller's own `server_members.timeout_until`.

- [ ] **Step 1: Detect the caller's active timeout for a channel target**

In `MessageInput.tsx`, add state + an effect that (only for channel targets) resolves the channel's server and reads the current user's `timeout_until`:

```tsx
  const [timedOutUntil, setTimedOutUntil] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !("channel_id" in target)) { setTimedOutUntil(null); return; }
    let active = true;
    (async () => {
      const { data: ch } = await supabase.from("channels").select("server_id").eq("id", target.channel_id).single();
      const serverId = (ch as { server_id: string } | null)?.server_id;
      if (!serverId) return;
      const { data: mem } = await supabase.from("server_members").select("timeout_until").eq("server_id", serverId).eq("user_id", user.id).single();
      const until = (mem as { timeout_until: string | null } | null)?.timeout_until ?? null;
      if (active) setTimedOutUntil(until && new Date(until) > new Date() ? until : null);
    })();
    return () => { active = false; };
  }, [supabase, user, target]);
```

- [ ] **Step 2: Disable the composer while timed out**

Guard the bar: when `timedOutUntil` is set, render a notice instead of the normal placeholder and block sending. Change the textarea's `disabled`/placeholder and the submit guard:
- In `submit()`, add at the top: `if (timedOutUntil) return;`
- On the `<textarea>`, add `disabled={!!timedOutUntil}` and set its placeholder to `timedOutUntil ? \`You're timed out until ${new Date(timedOutUntil).toLocaleString()}\` : (uploading ? "Uploading…" : placeholder)`.
- Also disable the `+` and emoji buttons when `timedOutUntil` (add `|| !!timedOutUntil` to their existing `disabled`).

- [ ] **Step 3: Build + full test suite**

Run: `npm run build && npx vitest run`
Expected: build succeeds; tests pass (existing + moderation.test.ts). (The pre-existing `tests/grouping.test.ts` tsc-only error does not fail either command.)

- [ ] **Step 4: Commit**

```bash
git add src/components/messages/MessageInput.tsx
git commit -m "feat: composer shows a timed-out notice and blocks sending"
```

---

### Task 7: Apply migration + manual verification

**Files:** none.

- [ ] **Step 1: Apply the migration**

Controller diffs `0018_moderation.sql` verbatim against Task 3, applies it (`npx vercel`-independent — Supabase: `npx supabase db push`, user-authorized), and confirms `migration list` shows `0018` remote. Do not proceed until applied.

- [ ] **Step 2: Manual verification (multi-user, localhost)**

With ≥2 accounts (one owner / a mod with roles, one plain member):
1. Give a non-owner a role with **only `timeout_members`** (via Roles UI). As that mod, open Members → a lower-ranked member's `⋯` shows **Timeout** only (no Kick/Ban); the owner and equal/higher members show no `⋯` actions.
2. **Timeout** the member (5 min) → as that member, sending a message fails (composer shows "You're timed out until …") and adding a reaction fails; reading still works; DMs still work. **Remove timeout** → they can post again. A timed-out member shows the clock glyph in the list.
3. Grant `kick_members` → **Kick** the member → they lose the server; they can rejoin via invite.
4. Grant `ban_members` → **Ban** with a reason → they lose the server and **cannot** rejoin (join blocked); they appear in **Server Settings → Banned** with the reason; **Unban** → they can rejoin.
5. Owner can do all three on any non-owner regardless of roles; nobody can act on the owner or themselves.
6. Direct-table bypass attempts fail: a member calling `server_members.delete()` on someone else, or a timed-out user inserting a message/reaction, are rejected by RLS.

- [ ] **Step 3: Record results**

Note pass/fail per item; fix and re-verify any failure before completion.

---

## Self-Review

**Spec coverage:**
- Three permissions + labels → Task 1. ✓
- `canModerate` mirror + presets (tested) → Task 2. ✓
- Widened CHECK, `my_permissions` owner fix, `timeout_until`, `bans`, helpers, `can_moderate`, 4 RPCs, join-block, send + reaction timeout guards, bans SELECT → Task 3. ✓
- Per-member ⋯ menu (timeout presets / kick / ban) with hierarchy+permission gating, confirms, timeout glyph → Task 4. ✓
- Banned list + Unban in Server Settings → Task 5. ✓
- Composer own-timeout notice → Task 6. ✓
- Migration apply + multi-user manual (incl. RLS bypass checks) → Task 7. ✓

**Placeholder scan:** No TBD/TODO; full SQL and component code given; test code concrete.

**Type consistency:** `canModerate(ModerationCheck)` fields match Task 4's call sites (`isOwner`, `hasPerm`, `viewerRank`, `targetRank`, `targetIsOwner`, `targetIsSelf`). RPC names/args are consistent: `kick_member(srv,target)`, `ban_member(srv,target,reason)`, `unban_member(srv,target)`, `timeout_member(srv,target,until)` — same in Task 3 SQL and Tasks 4–5 calls. `server_role_rank`/`my_role_rank` floor reconciled to -1. `bans` columns (`user_id`, `reason`, `banned_by`) match the Task 5 select and the `Ban` type in Task 1. Permission strings (`kick_members`/`ban_members`/`timeout_members`) match across permissions.ts, the CHECK allowlist, `my_permissions`, and `has(...)` calls.
