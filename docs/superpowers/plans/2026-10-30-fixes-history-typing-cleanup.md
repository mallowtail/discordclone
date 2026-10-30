# Fixes, Message History, Pins, Typing Indicators & Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the DM privacy hole, load the newest messages with load-older-on-scroll, make pinned messages independent and paged, add private typing indicators, and get the repo to 0 lint / 0 tsc errors with small a11y and docs cleanup.

**Architecture:** One migration (0026) drops two open RLS insert policies and adds Realtime Authorization policies for private `typing-*` broadcast topics. `useMessages` becomes cursor-paged (newest 50, then older 50s) with DM anchor support; `MessageList` preserves scroll on prepend. A new `usePinnedMessages` hook queries pins directly (newest-pinned first, paged 20). A new `useTyping` hook owns one private broadcast channel per chat view. Pure logic lives in `src/lib/` with vitest tests.

**Tech Stack:** Next.js 16.2.6 (App Router, client components), React 19.2, Supabase (`@supabase/supabase-js` 2.106.1, Postgres RLS, Realtime broadcast + postgres_changes), Tailwind v4 tokens, vitest 4, Phosphor icons.

**Spec:** `docs/superpowers/specs/2026-10-30-fixes-history-typing-cleanup-design.md`. Read it before your task.

## Global Constraints

- Read `node_modules/next/dist/docs/` for any Next API you touch (e.g. `useSearchParams` Suspense rules). This Next version differs from training data (AGENTS.md).
- NEVER run `npx supabase db push` or otherwise touch the live database. The controller does that after user approval.
- Migration number: **0026**, file `supabase/migrations/0026_lock_dm_membership_and_typing.sql`.
- Do NOT change the Supabase "Allow public access" Realtime setting; existing `postgres_changes`/presence channels are public and must keep working.
- Message page size **50**; pin page size **20**; typing broadcast throttle **~2.5 s**; typist expiry **5 s**.
- Typing copy, exact: `Alex is typing...` / `Alex and Sam are typing...` / `Alex, Sam, and Daniel are typing...` / `Several people are typing...` (4+). Never show yourself.
- Pinned order: `pinned_at desc` (newest pinned first).
- UI uses existing tokens only (`text-muted`, `text-meta`, `bg-surface`, `rounded-control`, `Skeleton`, etc.), Phosphor icons, no new deps.
- Behaviour-preserving: the anchored `?msg=` jump, optimistic pending rows, realtime INSERT/UPDATE/DELETE, mark-read, reply flow all keep working.
- Baselines going in: `npm test` 176 pass; `npx tsc --noEmit` 1 error (`tests/grouping.test.ts`, fixed in Task 8); lint 30 errors/41 warnings (fixed in Task 7). No task may ADD tsc errors or lint errors. Tasks 1–6 must leave lint error count ≤ 30.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Older page overlaps realtime/optimistic rows.** A message that arrived via realtime (or is pending) and also comes back in an older page must appear once, in `created_at` order. Covered by `mergeMessages` tests (Task 2).
2. **Short chats.** A chat with < 50 messages must set `hasMore=false` and never show a perpetual loader. A first page that doesn't fill the viewport must keep loading older pages until it overflows or `hasMore` is false. Covered by `hasMoreAfter` tests (Task 2) + a manual check (Task 3).
3. **Switching chats mid-load.** An older page that resolves after the user switched channel/DM must be discarded, not merged into the new chat. Covered by the stale-target guard in Task 2 Step 3, and the reviewer verifies.
4. **Typist vanishes** (closes tab, loses network) and never sends "stopped": they disappear within 5 s. Covered by `pruneTypists` tests (Task 5).
5. **Pin toggled on a message not in the loaded pin pages**, or re-pinned while already listed: the list stays deduped and sorted, and unpin removes it. Covered by `applyPinUpdate` tests (Task 4).

---

### Task 1: Migration 0026 + smoke script

**Files:**
- Create: `supabase/migrations/0026_lock_dm_membership_and_typing.sql`
- Create (untracked, not committed): `scratchpad/typing-dm-smoke.mjs`

**Interfaces:**
- Produces: realtime topics `typing-channel:<channel uuid>` and `typing-dm:<conversation uuid>`, usable ONLY with `{ config: { private: true } }` by members. SQL fn `public.can_access_typing_topic(topic text) returns boolean`.

- [ ] **Step 1: Write the migration.** Header comment explaining both changes. Contents:
  - `drop policy if exists "add members to conversations" on public.conversation_members;`
  - `drop policy if exists "authenticated create conversations" on public.conversations;`
  - Comment: membership/conversation creation happens only via SECURITY DEFINER `get_or_create_dm` (0024).
  - `public.can_access_typing_topic(topic text) returns boolean`, `language plpgsql stable security definer set search_path = public`: if topic matches `^typing-channel:[0-9a-f-]{36}$` return `public.is_channel_member(split_part(topic, ':', 2)::uuid)`; if `^typing-dm:[0-9a-f-]{36}$` return `public.is_conversation_member(...)`; else false. The regex check precedes the cast so malformed topics return false, not an error. Grant execute to authenticated.
  - Policies on `realtime.messages` for `authenticated`: `"typing receive"` FOR SELECT USING and `"typing send"` FOR INSERT WITH CHECK, both `realtime.messages.extension = 'broadcast' and public.can_access_typing_topic((select realtime.topic()))`.
- [ ] **Step 2: Write `scratchpad/typing-dm-smoke.mjs`**, following the style of existing `scratchpad/*-smoke.mjs` (read one first for env loading + sign-in helpers). It signs in 3 test users A, B, C. It must assert:
  (a) C's `insert` into `conversation_members` for A↔B's conversation fails;
  (b) A's `rpc('get_or_create_dm', {other: B})` still returns the conversation id;
  (c) A subscribes private to `typing-dm:<conv>` → status `SUBSCRIBED`; C → not subscribed (`CHANNEL_ERROR`/timeout);
  (d) B, subscribed, receives a broadcast A sends.
  Print PASS/FAIL per check. Do NOT run it; it runs after the controller pushes 0026.
- [ ] **Step 3: Static check.** Run `npm test` and `npx tsc --noEmit`. Expected: unchanged baselines.
- [ ] **Step 4: Commit** the migration only: `git add supabase/migrations/0026_lock_dm_membership_and_typing.sql && git commit -m "feat(db): lock DM membership inserts; private typing topic RLS"`

### Task 2: Paged `useMessages` (newest-first fix, loadOlder, DM anchors)

**Files:**
- Create: `src/lib/messagePaging.ts`, `tests/messagePaging.test.ts`
- Modify: `src/hooks/useMessages.ts`

**Interfaces:**
- Produces (`src/lib/messagePaging.ts`):
  - `export const MESSAGE_PAGE = 50;`
  - `mergeMessages(prev: Message[], incoming: Message[]): Message[]`: union by id (an incoming row replaces an existing id, EXCEPT an existing non-pending row is not overwritten by a pending one), sorted by `created_at` ascending, stable.
  - `hasMoreAfter(pageLength: number, pageSize: number): boolean` → `pageLength >= pageSize`.
- Produces (`useMessages`): `Target = { channelId: string; anchorId?: string | null } | { conversationId: string; anchorId?: string | null }`. Returns `{ messages, addPending, removePending, anchored, loadOlder: () => Promise<void>, loadingOlder: boolean, hasMore: boolean }`.

- [ ] **Step 1: Write failing tests** in `tests/messagePaging.test.ts` (build `Message` fixtures with ALL fields, as in other tests):
  - `mergeMessages dedupes an older page overlapping realtime rows`: prev `[m3,m4]`, incoming `[m1,m2,m3]` → ids `[m1,m2,m3,m4]`.
  - `mergeMessages keeps created_at order when incoming is newer`: prev `[m1]`, incoming `[m2]` → `[m1,m2]`.
  - `mergeMessages: incoming non-pending replaces pending with same id` → result row has `pending` falsy.
  - `mergeMessages: pending never overwrites confirmed row` → stays confirmed.
  - `hasMoreAfter(50, 50) === true`, `hasMoreAfter(49, 50) === false`, `hasMoreAfter(0, 50) === false`.
- [ ] **Step 2: Run** `npx vitest run tests/messagePaging.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `messagePaging.ts`, then update `useMessages`:
  - Recent load: `.order("created_at", { ascending: false }).limit(MESSAGE_PAGE)`, reverse, set; `hasMore = hasMoreAfter(len, MESSAGE_PAGE)`.
  - Anchored load: enable for BOTH targets (anchorId from either branch). Keep its 50-before/50-after shape; `hasMore` from the "before" page length.
  - `loadOlder()`: no-op if `loadingOlder || !hasMore` or no messages. Query `.lt("created_at", oldestNonPending.created_at).order(desc).limit(MESSAGE_PAGE)`, reverse, `setMessages(prev => mergeMessages(prev, page))`, update `hasMore`. **Stale guard:** capture the current `column:value` key at call time; discard the result if the target changed (use a ref holding the current key).
  - The realtime-resubscribe `load()` (on SUBSCRIBED) must MERGE the fresh newest page into existing state via `mergeMessages`, not replace it (otherwise a reconnect wipes loaded history). Reset state to `[]` + `hasMore=true` only when the target changes.
  - Realtime INSERT path may use `mergeMessages(prev, [row])`.
- [ ] **Step 4: Run** `npm test`. Expected: all pass (176 + new). `npx tsc --noEmit`: still only the 1 baseline error.
- [ ] **Step 5: Commit** `feat: load newest messages first and page older history`.

### Task 3: Load-older on scroll in `MessageList` + DM anchor wiring

**Files:**
- Modify: `src/components/messages/MessageList.tsx`, `src/app/(app)/channels/[channelId]/page.tsx`, `src/app/(app)/dms/[conversationId]/page.tsx`

**Interfaces:**
- Consumes: `useMessages` returns from Task 2.
- Produces: `MessageList` new props `onLoadOlder?: () => void; loadingOlder?: boolean; hasMore?: boolean; startLabel?: string`.

- [ ] **Step 1: Scroll behaviour in `MessageList`.** Hold a ref to the scroll container.
  - `onScroll`: if `scrollTop < 200 && hasMore && !loadingOlder` → `onLoadOlder?.()`. Track `atBottomRef = scrollHeight - scrollTop - clientHeight < 150`.
  - **Prepend preservation:** in a `useLayoutEffect` on `messages`, if the first message id changed and the last didn't (a prepend), set `scrollTop = newScrollHeight - prevScrollHeight + prevScrollTop`, using values recorded before the update (record them in the scroll handler / right before calling `onLoadOlder`).
  - **Auto-scroll to bottom** (existing non-anchored branch) only when: first content load, OR `atBottomRef` was true, OR the newly appended last message is the user's own. Never on a prepend.
  - **Fill-the-viewport:** after a load settles, if `scrollHeight <= clientHeight && hasMore && !loadingOlder`, call `onLoadOlder()`.
  - Top of list: when `loadingOlder`, render two `MessageRowSkeleton` rows. When `!hasMore && messages.length > 0 && startLabel`, render a small `text-meta text-muted px-4 py-2` line with `startLabel`.
- [ ] **Step 2: Wire pages.** Channel: pass `onLoadOlder={loadOlder} loadingOlder hasMore startLabel={`This is the start of #${channel.name}`}`. DM: read `msg` via `useSearchParams` (per the Next docs, wrap in Suspense if required), pass `anchorId` to `useMessages({ conversationId, anchorId })`, pass `anchorId`/`anchored` to `MessageList`, add the same "Jump to present ↓" button as channels (`router.replace(pathname)`), `startLabel="This is the start of your conversation"`.
- [ ] **Step 3: Verify.** `npm test`, `npx tsc --noEmit` (1 baseline), `npm run build` OK. Manual check with `npm run dev` (controller does the full two-session pass later): in a channel with > 50 messages the newest shows; scrolling up loads older without jumping; a new incoming message while scrolled up does NOT yank to bottom; `/dms/<id>?msg=<id>` flashes the message.
- [ ] **Step 4: Commit** `feat: infinite scroll for older messages; anchored jumps in DMs`.

### Task 4: Independent, paged pinned messages

**Files:**
- Create: `src/lib/pins.ts`, `tests/pins.test.ts`, `src/hooks/usePinnedMessages.ts`
- Modify: `src/components/messages/PinnedPanel.tsx`, both chat pages

**Interfaces:**
- Produces (`src/lib/pins.ts`): `export const PIN_PAGE = 20;` `applyPinUpdate(list: Message[], row: Message): Message[]`: if `row.pinned`, upsert by id and sort `pinned_at` desc (nulls last); else remove by id.
- Produces (`usePinnedMessages(target: { channelId: string } | { conversationId: string }, open: boolean)`) → `{ pins: Message[], count: number, loadMore: () => Promise<void>, loading: boolean, hasMore: boolean }`. `count` is always live (even when closed). The page list loads when `open` becomes true and resets on close/target change.
- `PinnedPanel` props become `{ pins: Message[]; loading: boolean; hasMore: boolean; onLoadMore: () => void; onClose: () => void }`.

- [ ] **Step 1: Failing tests** `tests/pins.test.ts`:
  - `applyPinUpdate inserts a newly pinned message at the top` (newer pinned_at first).
  - `applyPinUpdate does not duplicate an already-listed pin` (same id → length unchanged, row replaced).
  - `applyPinUpdate removes on unpin`.
  - `applyPinUpdate on unpin of unknown id is a no-op`.
- [ ] **Step 2: Run** `npx vitest run tests/pins.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `pins.ts` + hook:
  - Count: `select("id", { count: "exact", head: true }).eq(col, val).eq("pinned", true)`.
  - Page: `.eq("pinned", true).order("pinned_at", { ascending: false }).limit(PIN_PAGE)`, cursor `.lt("pinned_at", last.pinned_at)`, `hasMore = len >= PIN_PAGE`.
  - Realtime: its own channel, topic `pins:${col}:${val}:${useId()}`, `postgres_changes` UPDATE + DELETE filtered by `${col}=eq.${val}` (DELETE unfiltered, like useMessages). On UPDATE: `applyPinUpdate` + refetch count. On DELETE: remove + refetch count.
- [ ] **Step 4: Rework `PinnedPanel`**: keep outside-click/Escape/name resolution (resolve names for newly loaded authors only). Add `max-h-[60vh] overflow-y-auto` list; when scrolled within 100px of the bottom and `hasMore && !loading` → `onLoadMore()`; loading → skeleton rows; empty + not loading → existing "No pinned messages yet." Jump: if `#msg-<id>` exists, scroll as now; else `router.replace(`${pathname}?msg=${id}`)` (works in channels and, after Task 3, DMs). Close the panel either way.
- [ ] **Step 5: Wire pages**: remove `messages.filter((m) => m.pinned)` in both pages; use `usePinnedMessages(target, showPins)`; header label `Pinned (${count})`.
- [ ] **Step 6: Verify** `npm test`, `npx tsc --noEmit`, `npm run build`. Commit `feat: pinned messages load independently, newest first, paged`.

### Task 5: Private typing indicators

**Files:**
- Create: `src/lib/typing.ts`, `tests/typing.test.ts`, `src/hooks/useTyping.ts`, `src/components/messages/TypingIndicator.tsx`
- Modify: `src/components/messages/MessageInput.tsx`, both chat pages

**Interfaces:**
- Consumes: Task 1 topics (`typing-channel:<id>` / `typing-dm:<id>`, private).
- Produces (`src/lib/typing.ts`):
  - `formatTyping(names: string[]): string`. Returns `""` for 0, else the exact copy from Global Constraints.
  - `type Typists = Record<string, { name: string; at: number }>`
  - `pruneTypists(t: Typists, now: number, ttlMs = 5000): Typists`: drops entries with `now - at >= ttlMs`.
  - `export const TYPING_THROTTLE_MS = 2500, TYPING_TTL_MS = 5000;`
- Produces (`useTyping(topic: string | null)`) → `{ names: string[]; notifyTyping: () => void; notifyStopped: () => void }`. Exactly one private channel per call. The broadcast event is `"typing"` with payload `{ user_id: string; name: string; typing: boolean }`. Self is ignored; display name comes from `useAuth().profile` (`display_name`, fall back to `username`).
- `MessageInput` new optional prop `onTyping?: (typing: boolean) => void`.

- [ ] **Step 1: Failing tests** `tests/typing.test.ts`:
  - `formatTyping([])` → `""`; `["Alex"]` → `"Alex is typing..."`; `["Alex","Sam"]` → `"Alex and Sam are typing..."`; `["Alex","Sam","Daniel"]` → `"Alex, Sam, and Daniel are typing..."`; 4 names → `"Several people are typing..."`.
  - `pruneTypists` keeps an entry at 4999 ms, drops it at 5000 ms.
- [ ] **Step 2: Run** `npx vitest run tests/typing.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement lib + hook.** The hook subscribes with `{ config: { private: true, broadcast: { self: false } } }`. Verify in `node_modules/@supabase/realtime-js` how the session JWT reaches Realtime for private channels; call `supabase.realtime.setAuth()` before subscribing only if the installed version needs it. Receiving `typing:true` sets `{name, at: Date.now()}`; `typing:false` deletes. A 1 s interval runs `pruneTypists`. `notifyTyping` sends at most once per `TYPING_THROTTLE_MS`; `notifyStopped` sends `typing:false` and resets the throttle. Clean up the channel on topic change/unmount; send stop on unmount if currently typing.
- [ ] **Step 4: `TypingIndicator({ names }: { names: string[] })`**: one line, `h-5 px-4 text-meta text-muted truncate`, always rendered (reserving its height so the composer never jumps), `aria-live="polite"`, text `formatTyping(names)`.
- [ ] **Step 5: Wire.** In `MessageInput`, call `onTyping?.(true)` in the textarea `onChange` when the new value is non-empty, and `onTyping?.(false)` when it becomes empty and after a successful send. In each page: `const typing = useTyping(`typing-channel:${channel.id}`)` / `` `typing-dm:${conversationId}` ``, render `<TypingIndicator names={typing.names} />` directly above `MessageInput`, and pass `onTyping={(t) => (t ? typing.notifyTyping() : typing.notifyStopped())}`.
- [ ] **Step 6: Verify** `npm test`, `npx tsc --noEmit`, `npm run build`. Commit `feat: private typing indicators in channels and DMs`.

### Task 6: Accessibility items, README, asset cleanup

**Files:**
- Modify: `src/components/servers/InviteDialog.tsx`, `src/components/user/ProfileCard.tsx`, `src/components/dms/DmSidebar.tsx`, `src/components/messages/MessageInput.tsx`, `src/app/invite/[code]/page.tsx`, `README.md`
- Delete: `public/file.svg`, `public/globe.svg`, `public/next.svg`, `public/vercel.svg`, `public/window.svg`

- [ ] **Step 1: A11y fixes** (exactly the spec §5 list):
  - InviteDialog: try/catch around `navigator.clipboard.writeText` → existing error state; `aria-label="Invite link"` on the input.
  - ProfileCard: inline DM send shows a `text-danger text-meta` error on validation fail / insert error; root gets `role="dialog"` and `aria-label` = `${display_name}'s profile`.
  - DmSidebar avatar span: `role="button" tabIndex={0}` + `onKeyDown` for Enter/Space doing the same as the click (preventDefault so the row link doesn't navigate).
  - MessageInput `+` button: `aria-haspopup="menu" aria-expanded={menuOpen}`; emoji button: `aria-label="Add emoji"` (+ `aria-expanded={emojiOpen}`).
  - Invite page login redirect: `encodeURIComponent(code)`.
- [ ] **Step 2: README** rewrite (beginner-friendly, ~40–70 lines): what it is (Discord-style chat for friends), stack (Next.js 16, Supabase, Vercel), local setup (`npm install`, copy `.env.example` → `.env.local` with the Supabase URL/anon key, `npm run dev`), `npm test` / `npm run lint`, migrations (`supabase/migrations/`, applied with `npx supabase db push`), and where specs/plans live.
- [ ] **Step 3: Delete the 5 SVGs**, after `grep -rn "file.svg\|globe.svg\|next.svg\|vercel.svg\|window.svg" src` returns nothing.
- [ ] **Step 4: Verify** `npm test`, `npx tsc --noEmit`, `npm run build`. Commit `chore: a11y fixes, real README, remove starter assets`.

### Task 7: Lint to zero errors

**Files:** `eslint.config.mjs` plus the files listed by `npx eslint src` (at plan time: `(app)/layout.tsx`, MentionAutocomplete, MessageInput ×2, MessageList, AuthProvider, MemberRolesDialog, MembersPanel, MessageSearchPanel (13 × `react-hooks/refs`), RolesDialog, ServerSettingsDialog, ServerSidebar, useMessageSearch, AccountSection (`no-unescaped-entities`), useMemberRoleColors, useReactions, useServerPermissions, useServers. Re-run lint first; Tasks 2–5 may have shifted lines.)

- [ ] **Step 1:** Add `"scratchpad/**"` to `globalIgnores` in `eslint.config.mjs`.
- [ ] **Step 2:** Fix each error. Preferred: the React docs patterns (derive during render instead of syncing state; reset state via `key`; move ref reads into effects/handlers; for `MessageSearchPanel` refs-during-render, move them into state or effects). Allowed: `// eslint-disable-next-line react-hooks/set-state-in-effect -- <one-line reason>` only where the pattern is genuinely correct (e.g. resetting loading state at the start of an async fetch effect) and a rewrite would risk behaviour. **Zero behaviour change.** `ForwardedBlock` `<img>` warning: leave it with a disable comment noting it's user-uploaded storage content.
- [ ] **Step 3: Verify** `npm run lint` → `0 errors`; `npm test` all pass; `npx tsc --noEmit` no new errors; `npm run build` OK.
- [ ] **Step 4: Commit** `chore: lint to zero errors`.

### Task 8: tsc to zero

**Files:** `tests/grouping.test.ts`

- [ ] **Step 1:** Fill in the `msg()` fixture with every required `Message` field (`image_url: null, file_url: null, file_name: null, updated_at: null, reply_to_id: null, mention_author: false, pinned: false, pinned_at: null, forward_snapshot: null`).
- [ ] **Step 2: Verify** `npx tsc --noEmit` → no output; `npm test` passes.
- [ ] **Step 3: Commit** `test: complete Message fixture in grouping test`.

---

## After all tasks (controller)

1. Show the user the 0026 SQL, get explicit approval, then `npx supabase db push`.
2. Run `node scratchpad/typing-dm-smoke.mjs`; all PASS.
3. Two-browser-session check (Playwright or manual): typing copy at 1/2/3/4+, expiry, scroll-up history, pins paging + jump, DM anchors.
4. Whole-branch review; final baselines: tests pass, tsc 0, lint 0 errors, build OK.
