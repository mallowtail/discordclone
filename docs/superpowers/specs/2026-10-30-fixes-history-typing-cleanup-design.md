# Fixes, Message History, Typing Indicators & Cleanup — Design

Date: 2026-10-30

## Intent

The app is feature-rich and live in production for ~30 school friends. A review turned up two real
bugs (one privacy, one that breaks every busy channel), two missing everyday chat features, and a
pile of housekeeping. This batch makes the app correct for long-running channels, makes it feel
more alive, and leaves the codebase clean (zero lint errors, zero type errors) for future slices.

## Goals

1. **Close the DM privacy hole** (RLS).
2. **Fix the "oldest 200 messages" load bug.**
3. **Load older messages** when scrolling to the top, plus **pinned messages loaded
   independently**, newest first and paged.
4. **Typing indicators** in channels and DMs.
5. **Cleanup/housekeeping**: lint, tsc, small a11y items, README, unused assets.

## Non-goals

- Browser notifications and the unread count in the tab title. The user dropped these ("don't
  worry about notifications for now").
- PWA / installable app.
- Threads, voice, custom emoji, drafts, rate limiting (future ideas only).
- Any visual redesign. New UI uses the existing Polished Dark tokens, Inter, and Phosphor icons.

## Anti-goals (failure even if it "works")

- The chat view jumps or loses the reader's place when older messages load in.
- The view auto-scrolls to the bottom while someone is reading history.
- Typing indicators that get "stuck" showing someone who has left or stopped typing.
- Typing events written to the database (they must be ephemeral).
- Cleanup that changes behaviour. Lint fixes are refactors, not feature changes.
- Breaking the existing anchored "jump to message" load (search results / reply jumps use
  `anchorId` in `useMessages`).

## Constraints

- Next.js 16 (read `node_modules/next/dist/docs/` before touching Next APIs; see AGENTS.md),
  React 19, Supabase (Postgres + RLS + Realtime), Tailwind v4 `@theme` tokens in `globals.css`.
- Migrations go in `supabase/migrations/` with the next number (**0026**). They are applied to the
  LIVE production DB via `npx supabase db push`, which the controller must preview with the user
  before running. Subagents must NOT run `db push`.
- Tests: vitest (`npm test`, currently 176 passing). Pure logic goes in `src/lib/` with tests in
  `tests/`, matching existing style.
- Baselines before this work: tsc 1 error (`tests/grouping.test.ts`), lint 71 problems
  (30 errors / 41 warnings), build OK.

## 1. DM privacy fix (decided)

**Problem.** `0001_init.sql` created policy `"add members to conversations"` on
`public.conversation_members` for insert `with check (true)`. Any logged-in user can insert a row
for any `conversation_id` and become a member, gaining read access to that DM's messages. DM ids
appear in URLs (`/dms/<id>`), so they leak.

**Fix.** Migration `0026_lock_dm_membership_and_typing.sql` (also holds the typing RLS from §4):
- `drop policy if exists "add members to conversations" on public.conversation_members;`
- `drop policy if exists "authenticated create conversations" on public.conversations;`

Membership and conversation creation now happen ONLY through the SECURITY DEFINER RPC
`get_or_create_dm` (0024), which bypasses RLS. Verified: no client code inserts into
`conversation_members` or `conversations` (all DM creation goes through `openDmWith` → RPC). No
replacement insert policy is needed. Include a header comment explaining why.

**No data cleanup (user decided).** The app isn't public yet; every account is the user's own or a
test account. Do not audit or delete existing `conversation_members` rows.

**Verification.** A live smoke test (in the untracked `scratchpad/` folder, matching the existing
`*-smoke.mjs` style) after push: user C cannot insert themselves into A↔B's conversation; A can
still open/create a DM with B via the RPC.

## 2. Load-the-newest fix (decided)

`src/hooks/useMessages.ts` recent-load path orders `created_at ascending` with `limit(200)`, which
returns the OLDEST 200. Change it to fetch the newest page (`descending`, limit) and reverse for
display. The initial page size becomes 50 (same as the anchored path) because older pages now
load on demand.

## 3. Load older messages (decided)

- When the user scrolls to (near) the top of the message list, the next 50 older messages load
  automatically. No button.
- The reader's position is preserved: the message they were looking at stays in the same place
  on screen (scroll-height compensation, or the equivalent).
- While loading, show a small loading row at the top using the existing `Skeleton` style. When
  there is no more history, show nothing extra, or a subtle "start of #channel" / "start of your
  conversation" line (builder's call, existing tokens).
- `useMessages` exposes something like `{ loadOlder, loadingOlder, hasMore }`. `hasMore` becomes
  false when a page returns fewer than the page size.
- Must cooperate with: realtime INSERT/UPDATE/DELETE, optimistic pending rows, dedupe by id
  (older pages can overlap with realtime rows), the anchored load (anchored mode also gets
  load-older from its top; loading *newer* after an anchor is out of scope), and auto-scroll-to-
  bottom on new messages, which must only happen when the user is already at the bottom.
- Works the same in channels and DMs (both use `useMessages` + `MessageList`).
- Known consequence (accepted): reply-quote resolution only looks at loaded messages, so it sees
  fewer initially (50 instead of 200). Reply quotes for an unloaded parent must degrade
  gracefully, as they already do for out-of-window parents. Builder: confirm this is graceful and
  note it if not.

## 3b. Pinned messages, independent of the chat history (user decided)

Today `PinnedPanel` receives `messages.filter((m) => m.pinned)` from the loaded chat window
(channel page ~L216, DM page ~L29), and the header's `Pinned (n)` count comes from the same
filter. With 50-message pages that would hide most pins. The user wants:

- **Pins load on their own**, straight from the DB (`pinned = true` for this channel/DM), not
  from the loaded chat messages.
- **Newest pinned first** (order by `pinned_at desc`).
- **Paged inside the panel:** the first page loads when the panel opens (about 20); scrolling
  down to the bottom of the panel loads the next, older page. The panel gets a max height and its
  own scroll area.
- **Live:** pinning/unpinning (via `toggle_pin`) while the panel is open updates the list. A
  newly pinned message appears at the top; an unpinned one disappears. Edits and deletes of
  pinned messages are reflected too.
- **Header count is accurate:** `Pinned (n)` uses a real count from the DB (e.g. a
  `count: 'exact', head: true` query, refreshed on pin/unpin), not the loaded window.
- **Jump works for unloaded pins:** clicking a pin whose message is loaded scrolls to it as now.
  If it isn't loaded, navigate to the anchored view (channels already support `?msg=<id>` via
  `useMessages` `anchorId`). **Extend anchored loading to DMs** (same `?msg=` param, same
  behaviour) so jump works there too.
- Author names: keep resolving display names for the loaded pins (current approach is fine,
  just per page).
- Logic like the paging cursor can live in a small hook (e.g. `usePinnedMessages`). Pure helpers
  are tested where there's real logic.

## 4. Typing indicators (decided)

- Ephemeral, via **Supabase Realtime broadcast** on a per-chat channel (e.g. `typing:<channelId>`
  / `typing:<conversationId>`). Nothing is stored in the DB. All participants MUST share the same
  topic (broadcast only reaches subscribers of the same topic, so the `useId()` unique-topic
  pattern from `useMemberRoleColors.ts` does NOT apply here). Instead ensure exactly one
  subscription per chat view (one hook instance owning the channel, others receiving data via
  props/context), to avoid the "cannot add callbacks after subscribe()" error from reusing a topic.
- **Private channels, members only (user decided).** Subscribe with
  `{ config: { private: true } }` and add Realtime Authorization RLS policies on
  `realtime.messages` in migration 0026 (select = receive, insert = send; extension `broadcast`),
  allowing an authenticated user only when they are a member of the chat named in the topic.
  Use distinct, parseable topic prefixes, e.g. `typing-channel:<channel uuid>` (check
  `public.is_channel_member`) and `typing-dm:<conversation uuid>` (check
  `public.is_conversation_member`), matched via `realtime.topic()`. Guard the uuid cast so a
  malformed topic denies rather than errors. Read the installed `@supabase/realtime-js` /
  supabase-js docs for how the user's JWT reaches Realtime for private channels.
  **Do NOT turn off "Allow public access" in the Supabase Realtime settings.** Existing features
  (`postgres_changes` subscriptions, presence) use public channels and would break.
  Smoke test: a non-member cannot subscribe to or send on another chat's typing topic; members can.
- While the user types in the composer, broadcast a "typing" event, throttled (about one every
  2–3 s). On send, or when the composer is cleared, broadcast "stopped" (or just stop sending).
- Receivers expire a typist after about 5 s with no new event, and drop them immediately on
  "stopped" or when that user's message arrives.
- Never show yourself.
- Shown as a single small line directly above the composer (`text-muted`, small size), in both
  channel and DM views. It reserves its space or animates so the composer doesn't jump; builder's
  call on which.
- **Wording (user decided, exact):**
  - 1: `Alex is typing...`
  - 2: `Alex and Sam are typing...`
  - 3: `Alex, Sam, and Daniel are typing...`
  - 4+: `Several people are typing...`
- Names use display name (fall back to username), same as message author display.
- The pure formatting function (list of names → string) lives in `src/lib/` with tests covering
  0/1/2/3/4+.

## 5. Cleanup & housekeeping (decided)

- **Lint → 0 errors.**
  - Add `scratchpad/**` to `globalIgnores` in `eslint.config.mjs` (untracked throwaway smoke
    scripts produce all 40 `no-unused-expressions` warnings).
  - Fix the React Compiler rule errors in `src/` (13 `react-hooks/refs`, 16
    `react-hooks/set-state-in-effect`) and the 1 `react/no-unescaped-entities`. Prefer real fixes
    per the React docs' patterns. A targeted `eslint-disable-next-line` with a one-line reason is
    acceptable ONLY where the flagged pattern is genuinely correct (e.g. a fetch-then-set in an
    async effect callback) and a rewrite would be riskier than the rule's benefit. Zero behaviour
    change.
  - The 1 `@next/next/no-img-element` warning may stay if `<img>` is deliberate (user-uploaded
    images from Supabase Storage); otherwise fix. Builder's call.
- **tsc → 0 errors.** Fix the fixture in `tests/grouping.test.ts` (fill in the missing `Message`
  fields). The old "frozen" rule from the design-overhaul workspace no longer applies.
- **Accessibility items** from `.superpowers/sdd/minor-findings.md`:
  - InviteDialog: guard `clipboard.writeText` with try/catch → existing error state; add an
    `aria-label` to the invite input.
  - ProfileCard: show a user-facing error when the inline DM send fails; add `role="dialog"`
    plus a sensible accessible name.
  - DmSidebar avatar span: `role="button"`, `tabIndex={0}`, Enter/Space handler.
  - Composer `+` menu: `aria-expanded` / `aria-haspopup`. Emoji button: `aria-label`.
  - Invite page login redirect: `encodeURIComponent(code)`.
- **README:** replace the create-next-app boilerplate with a short description of the app, its
  stack (Next.js + Supabase + Vercel), how to run it locally (env vars from `.env.example`,
  `npm run dev`, `npm test`), and how migrations are applied (`npx supabase db push`). Written for
  a beginner.
- **Delete unused starter assets:** `public/file.svg`, `globe.svg`, `next.svg`, `vercel.svg`,
  `window.svg` (verified unreferenced in `src/`).
- (The merged `design-overhaul` branch is already gone locally and remotely. Nothing to do.)

## Done means

- tsc 0 errors, lint 0 errors, `npm test` passing (176 + new tests), `npm run build` OK.
- Migration 0026 written. After user approval it is pushed and the live smoke test passes.
- Typing indicator and history loading verified in a real browser with two sessions.

## Left to the builder

Exact scroll-preservation technique, loading-row visuals, typing-line layout/animation, throttle
and expiry constants (within the ranges above), file/component boundaries, and which lint fixes
are rewrites vs justified disables.
