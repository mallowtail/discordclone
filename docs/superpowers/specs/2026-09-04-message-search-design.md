# Message Search — design

**Date:** 2026-09-04
**Sub-project:** Message search (single slice: server-scoped full-text search with operators + jump-to-message).
**Status:** approved, ready for planning

## Goal

Let a member search the messages of the **server they're currently in** and jump to any match —
even an old one. Search runs in the existing right-side panel (shared with the Members list),
supports Discord-style operators, and is enforced in the database so results can never include
messages the searcher can't already read.

## Decisions (from brainstorming)

- **Scope:** the **current server** — all channels in it. Because channel-read = server membership
  (`is_channel_member` → `is_server_member`), a member can read every channel in the server, so
  "search the server" == "search every channel you can see there". No per-channel private overrides
  exist.
- **DM search is out of scope for this slice** (deferred). The DM screen has no right-side panel to
  host the search UI; adding one is a separate slice.
- **Operators (full set):** `from:username`, `in:#channel`, `has:link|image|file`,
  `before:`/`after:`/`during:` (dates), `mentions:@username`, `pinned:true`, plus free text.
- **Results UI** lives in the **same right-panel slot as the Members list**, opened by a search icon
  in the channel header (right of the Members button). Search **takes precedence** over Members while
  active; clearing it (✕) returns to whatever was there before.
- **Jump-to-message is a real jump:** clicking a result navigates to the channel and loads a window of
  messages around the target (even if months old), scrolls to it, and flashes it.
- **Enforcement:** a `SECURITY DEFINER` RPC that verifies server membership and only reads that
  server's channels — mirroring how moderation RPCs guard access. RLS remains the real guard; the RPC
  never returns rows from a server the caller isn't in.

## Mentions & usernames (verified)

- `@mentions` are stored as **plain `@username` text** in `messages.content` (regex
  `/(?<![a-zA-Z0-9_])@([a-zA-Z0-9_]{2,32})/g`, see `src/lib/mentions.ts`). There is no mention join
  table. So `mentions:@alex` is a content-token match on `@alex`, and `from:alex` resolves via
  `profiles.username` (which is `unique not null`, `0001_init.sql:4`). Both operators key off
  **username**, not `display_name`.

## Messages schema (relevant columns, from the code map)

`messages` (`0001_init.sql` + later): `id uuid pk`, `author_id uuid`, `channel_id uuid null`,
`conversation_id uuid null`, `content text`, `created_at timestamptz`, `updated_at timestamptz`
(edited marker), `image_url text`, `file_url text`, `file_name text`, `reply_to_id uuid`,
`pinned boolean`, `pinned_at timestamptz`, `forward_snapshot jsonb`. Exactly one of
`channel_id`/`conversation_id` is set. Read RLS: channel messages gated by `is_channel_member`,
DM messages by `is_conversation_member`; `can_read_message(msg)` combines both.

## Schema — migration `supabase/migrations/0020_message_search.sql`

1. **Full-text column + index** on messages:
```sql
alter table public.messages
  add column if not exists content_tsv tsvector
  generated always as (to_tsvector('english', coalesce(content, ''))) stored;

create index if not exists messages_content_tsv_idx
  on public.messages using gin (content_tsv);
```
(Generated column — no trigger needed; it recomputes automatically when `content` is edited.)

2. **Search RPC** (`SECURITY DEFINER`, `set search_path = public`):
```sql
create or replace function public.search_messages(
  srv          uuid,
  text_query   text        default null,
  from_user    text        default null,   -- username (no leading @)
  in_channel   text        default null,   -- channel name (no leading #)
  has_type     text        default null,   -- 'link' | 'image' | 'file'
  before_ts    timestamptz default null,   -- created_at < before_ts
  after_ts     timestamptz default null,   -- created_at > after_ts
  mentions_user text       default null,   -- username (no leading @)
  only_pinned  boolean     default false,
  lim          int         default 25,
  off          int         default 0
) returns table (
  id uuid, channel_id uuid, channel_name text,
  author_id uuid, author_username text, author_display_name text, author_avatar_url text,
  content text, image_url text, file_url text, file_name text,
  pinned boolean, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select m.id, m.channel_id, c.name,
         m.author_id, p.username, p.display_name, p.avatar_url,
         m.content, m.image_url, m.file_url, m.file_name,
         m.pinned, m.created_at
  from public.messages m
  join public.channels c on c.id = m.channel_id
  join public.profiles p on p.id = m.author_id
  where c.server_id = srv
    and public.is_server_member(srv)                       -- membership guard (empty result if not a member)
    and (text_query   is null or m.content_tsv @@ websearch_to_tsquery('english', text_query))
    and (from_user    is null or p.username = from_user)
    and (in_channel   is null or c.name = in_channel)
    and (has_type is null
         or (has_type = 'link'  and m.content ~* 'https?://')
         or (has_type = 'image' and m.image_url is not null)
         or (has_type = 'file'  and m.file_url  is not null))
    and (before_ts    is null or m.created_at <  before_ts)
    and (after_ts     is null or m.created_at >  after_ts)
    and (mentions_user is null or m.content ~* ('@' || mentions_user || '\y'))
    and (not only_pinned or m.pinned)
  order by m.created_at desc
  limit greatest(1, least(lim, 50)) offset greatest(0, off);
$$;

grant execute on function public.search_messages(
  uuid, text, text, text, text, timestamptz, timestamptz, text, boolean, int, int
) to authenticated;
```
Notes:
- **`is_server_member(srv)` guard** makes the whole result empty for a non-member (defence in depth on
  top of RLS). Combined with `c.server_id = srv`, results can only ever come from that one server's
  channels.
- `websearch_to_tsquery` handles quoted phrases, `-exclusion`, and bare words safely (no query-syntax
  errors from user input).
- `mentions_user` match uses a `@username\y` (word-boundary) regex so `@alex` does not match
  `@alexander`. `from_user` uses exact `username` equality (usernames are unique).
- The plan must **read `is_server_member`'s signature** (`0005_servers.sql:47-50`) and call it exactly.

## Operator autocomplete — pure helpers + dropdown

Discord-style suggestion dropdown while the search input is focused, mirroring the composer's
`@mention` autocomplete idiom (`src/components/messages/MentionAutocomplete.tsx` +
`mentionQueryAt` in `MessageInput.tsx`).

### Pure helpers — `src/lib/searchSuggest.ts` (unit-tested)
```ts
// The whitespace-delimited token containing the caret (for replacement on accept).
export function activeToken(raw: string, caret: number): { token: string; start: number; end: number };

// Classify what the active token wants suggested.
export type SuggestKind = "operator" | "from" | "mentions" | "in" | "has" | "pinned" | "date" | null;
export function suggestKind(token: string): { kind: SuggestKind; partial: string };

// Replace the active token with `value`, returning the new raw string + new caret position.
export function applySuggestion(
  raw: string, caret: number, value: string
): { raw: string; caret: number };
```
Rules:
- `suggestKind`:
  - Token contains no `:` → `{ kind: "operator", partial: token }` (suggest operator names filtered by
    `partial`; an empty token suggests all operators).
  - `from:x`/`mentions:x` → `{ kind: "from"|"mentions", partial: "x" }` (x may be empty; strip a leading `@`).
  - `in:x` → `{ kind: "in", partial: "x" }` (strip a leading `#`).
  - `has:x` → `{ kind: "has", partial: "x" }`.
  - `pinned:x` → `{ kind: "pinned", partial: "x" }`.
  - `before:`/`after:`/`during:` → `{ kind: "date", partial: "x" }`.
  - Unknown `key:` → `{ kind: null }` (no suggestions).
- `applySuggestion` replaces `[start,end)` with `value`, placing the caret at the end of `value`.
  - Accepting an **operator** inserts e.g. `from:` (no trailing space — the caret stays ready for the value).
  - Accepting a **value** (username/channel/`link`/`true`) inserts the value + a trailing space.

### Dropdown — inside `MessageSearchPanel`
- Data: **server members** (fetched via `server_members` → `profiles`, the `MembersPanel` pattern) and
  **channels** (channels in this server, the `ForwardDialog` pattern). Fetched once when the panel opens.
- Given `suggestKind`, render:
  - `operator` → matching operator rows (label + short hint, e.g. `from:` — "messages from a user").
  - `from`/`mentions` → members whose `username` or `display_name` matches `partial` (avatar + name; inserts `username`).
  - `in` → channels whose `name` matches `partial` (`#name`; inserts `name`).
  - `has` → `link` / `image` / `file` filtered by `partial`.
  - `pinned` → `true`.
  - `date` → a single non-selectable hint row: `YYYY-MM-DD or YYYY-MM`.
- Keyboard (mirror `MentionAutocomplete`): ↑/↓ move the highlighted row; **Enter/Tab accept** the
  highlighted suggestion via `applySuggestion`; **Esc closes the dropdown** (a second Esc / the ✕ closes
  search). **Enter runs the search only when the dropdown is closed / has no suggestions.**

## Client query parser — `src/lib/searchQuery.ts` (pure, unit-tested)

```ts
export type ParsedQuery = {
  text: string;               // free-text remainder (may be "")
  from?: string;              // username, leading @ stripped
  in?: string;                // channel name, leading # stripped
  has?: "link" | "image" | "file";
  mentions?: string;          // username, leading @ stripped
  pinned?: boolean;           // pinned:true
  beforeTs?: string;          // ISO, from before:/during:
  afterTs?: string;           // ISO, from after:/during:
};
export function parseSearchQuery(raw: string): ParsedQuery;
```
Rules:
- Tokenize on whitespace (respecting `"double quotes"` as a single text token).
- Recognized `key:value` tokens (case-insensitive key): `from`, `in`, `has`, `mentions`, `pinned`,
  `before`, `after`, `during`. Strip a leading `@` from `from`/`mentions`, a leading `#` from `in`.
- `has:` only accepts `link|image|file`; any other value is treated as free text.
- `pinned:` is truthy only for `true`/`yes`/`1`; otherwise ignored.
- **Dates** (`before`/`after`/`during`) accept `YYYY-MM-DD` or `YYYY-MM`:
  - `before:D` → `beforeTs = start of D` (messages strictly before that day/month).
  - `after:D`  → `afterTs  = end of D` (messages strictly after that day/month).
  - `during:D` → `afterTs = start of D`, `beforeTs = start of the next day/month` (that whole day/month).
  - Invalid dates are dropped (token ignored), not errored.
- Every unrecognized token and all quoted/plain words concatenate (space-joined) into `text`.
- The panel maps `ParsedQuery` → RPC args (`before`/`after` ISO strings become `timestamptz`).

## UI

### Channel header — `channels/[channelId]/page.tsx` (`ChannelView`)
- Add a **`MagnifyingGlass` icon button** right of the Members button. It toggles a `searchActive`
  boolean (lifted into `ChannelView`).
- Right-panel slot renders: **`searchActive` → `<MessageSearchPanel>` ; else `showMembers` →
  `<MembersPanel>` ; else nothing.** (Search takes precedence; Members state persists underneath.)
- Read `?msg=<id>` (via `useSearchParams`) to drive jump/anchor mode (see below).

### `src/components/servers/MessageSearchPanel.tsx` (new)
- Same shell/width as `MembersPanel` (`w-56`-family, `bg-sidebar border-l`), matching the
  `ForwardDialog` search-input idiom (`MagnifyingGlass`, `autoFocus`, `bg-surface-2`, `focus:ring-accent`).
- **Header row:** the search `<input>` + an **✕** button on its right. ✕ sets `searchActive=false`
  (clears the query and closes the panel; Members returns if it was open).
- **Debounced query** (~250 ms): parse via `parseSearchQuery`, resolve dates, call
  `supabase.rpc("search_messages", { srv: serverId, ... , lim, off: 0 })`. Empty/whitespace query ⇒
  show a hint ("Search this server"), no call.
- **Results list:** one clickable row per match — author avatar + `display_name`, `#channel_name`,
  relative time, and a content snippet (plain, truncated). "No results" state. **"Load more"** button
  increments `off` by `lim` and appends.
- **Row click** → jump (below). Row also closes nothing (panel can stay open) — jumping just changes
  the left message view.
- Errors from the RPC show an inline "Search failed" line; never throw.

### Jump-to-message
- Row click resolves `{ channelId, messageId }`.
  - **Same channel:** set the anchor locally (update `?msg=` via `router.replace`) — no full nav.
  - **Different channel:** `router.push('/channels/'+channelId+'?msg='+messageId)`.
- **`useMessages` gains an anchor mode** (`useMessages({ channelId, anchorId })`):
  - When `anchorId` is set, load a **window** instead of "recent 200": fetch the anchor's
    `created_at`, then `<= anchor order by created_at desc limit 50` and
    `> anchor order by created_at asc limit 50`, merge ascending. If the anchor row can't be read
    (deleted / not visible), fall back to the normal recent load.
  - Expose an `anchored` flag so `MessageList` **does not force-scroll-to-bottom** while anchored.
  - Realtime stays subscribed; new inserts still append (acceptable — the window is a viewing state,
    not a hard boundary).
- **`MessageList`**: when `anchored`, after render scroll `#msg-<anchorId>` into view (`block:"center"`)
  and **flash** it via a `highlightedMessageId` state that reuses the amber mention style
  (`bg-amber/10 border-l-2 border-amber`) and clears after ~2 s.
- **"Jump to present ↓"** affordance (small button pinned bottom-right of the list while anchored):
  clears `?msg=` → `useMessages` returns to the live recent load + auto-scroll-to-bottom.

## Types — `src/types/db.ts`
- Add a `SearchResult` type mirroring the RPC's `returns table (...)` columns.

## Non-goals

- No DM search (deferred — DM view has no panel).
- Autocomplete suggests **operators and their values** (users, channels, `has`/`pinned` enums); it does
  **not** try to validate free-text or predict dates beyond a format hint.
- No relevance ranking beyond newest-first (no `ts_rank` sort). No highlighted match terms inside the
  snippet (plain truncation).
- No global/cross-server search; no saved searches; no result counts ("X results") beyond what's loaded.
- No infinite scroll — explicit "Load more" only.

## Testing

- **Unit** (`tests/searchQuery.test.ts`): `parseSearchQuery` truth tables — each operator parsed;
  leading `@`/`#` stripped; `has:` validation; `pinned:` truthiness; `before`/`after`/`during` →
  correct ISO bounds for both `YYYY-MM-DD` and `YYYY-MM`; invalid dates dropped; quoted phrase kept
  intact; unknown `key:` and bare words fall into `text`; empty input → empty `text`, no operators.
- **Unit** (`tests/searchSuggest.test.ts`): `activeToken` finds the token at various caret positions
  (start/middle/end, across multiple tokens, empty input); `suggestKind` classifies each operator
  prefix and returns the right `partial` (leading `@`/`#` stripped), bare word → `operator`, unknown
  `key:` → `null`; `applySuggestion` replaces the active token and positions the caret (operator vs
  value trailing-space behavior).
- **Migration:** controller diffs `0020_message_search.sql` verbatim vs this spec, then applies it. A
  **security-focused review** confirms: `is_server_member` guard present, `c.server_id = srv` scoping,
  `security definer` + `set search_path = public`, `grant execute` to `authenticated` only, and that
  user text reaches SQL only through `websearch_to_tsquery`/parameterized args (no injection).
- **Build/tests:** `npm run build` clean; `npx vitest run` green (adds search-parser tests).
- **Manual (multi-user, localhost):**
  - As a server member, search finds messages across the server's channels; newest first; "Load more"
    pages correctly.
  - A user who is **not** a member of a server gets **no** results from it (direct `rpc` call included).
  - Each operator: `from:`, `in:#`, `has:link|image|file`, `before:`/`after:`/`during:`,
    `mentions:@`, `pinned:true`, and combinations, return the expected subset.
  - **Jump:** clicking a result in another channel navigates there, loads around an **old** message,
    scrolls to it, and flashes it; "Jump to present" restores the live view. Same-channel jump works
    without a full reload.
  - The search icon opens the panel in the Members slot; results replace an open Members list; ✕
    restores Members (or closes the panel if Members was closed).
  - **Autocomplete:** typing a bare word suggests operators; `from:`/`mentions:` suggest members,
    `in:` suggests channels, `has:` suggests link/image/file, `pinned:` suggests true; ↑/↓ + Enter/Tab
    accept and insert the token; Enter with the dropdown closed runs the search.

## Operational note

One migration (`0020_message_search.sql`): the generated `content_tsv` column + GIN index and one
`SECURITY DEFINER` RPC. No new dependency, no env change. Everything else is front-end (a parser lib,
a search panel, and an anchor/jump extension to the existing message list). The `english` text-search
config is Postgres-builtin. Search honors visibility through the membership guard + server-scoped join;
RLS independently blocks any cross-server read.
