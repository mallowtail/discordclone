# Message Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server-scoped full-text message search with Discord-style operators, operator autocomplete, and real jump-to-message (loads around old messages).

**Architecture:** A Postgres `tsvector` index + a `SECURITY DEFINER` `search_messages` RPC (guarded by server membership) do the searching. Two pure, unit-tested client libs handle query parsing and autocomplete token logic. A new right-panel component (sharing the Members slot) runs the search and renders results; clicking a result navigates with `?msg=<id>`, and an anchor mode in `useMessages`/`MessageList` loads a window around that message and flashes it.

**Tech Stack:** Next.js 16 (App Router, client components), TypeScript, Supabase (Postgres RLS + RPC, realtime), Tailwind v4, Vitest, `@phosphor-icons/react`.

**Spec:** `docs/superpowers/specs/2026-09-04-message-search-design.md`

## Global Constraints

- **Next.js is non-standard** — read `node_modules/next/dist/docs/` before using any Next API you're unsure of (per `AGENTS.md`).
- **Search is server-scoped only** — never query DMs; the RPC joins `channels` and filters `c.server_id = srv`.
- **Security is the DB's job** — the RPC MUST keep `public.is_server_member(srv)` in its `where` and `security definer set search_path = public`; user text reaches SQL only via `websearch_to_tsquery` or bound parameters (no string interpolation).
- **Date-bound convention (parser ↔ RPC):** the RPC uses `created_at >= after_ts` and `created_at < before_ts`. The parser produces bounds to match: `before:D → beforeTs = start(D)`; `after:D → afterTs = start(D+1 unit)`; `during:D → afterTs = start(D), beforeTs = start(D+1 unit)`. `D` is `YYYY-MM-DD` or `YYYY-MM`.
- **Migrations** are applied with `npx supabase db push` (user-authorized). Next migration number is **0020**.
- **Test idiom:** Vitest, `import { describe, it, expect } from "vitest"`, imports via the `@/` alias. Run with `npx vitest run`.
- **Commits:** end messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- `src/lib/searchQuery.ts` (new) — `parseSearchQuery(raw) → ParsedQuery`, `toRpcArgs(parsed) → RpcArgs`. Pure.
- `src/lib/searchSuggest.ts` (new) — `activeToken`, `suggestKind`, `applySuggestion`. Pure.
- `src/lib/search.ts` (new) — `searchMessages(supabase, serverId, parsed, page) → Promise<SearchResult[]>`. Thin RPC wrapper.
- `supabase/migrations/0020_message_search.sql` (new) — `content_tsv` generated column + GIN index + `search_messages` RPC.
- `src/types/db.ts` (modify) — add `SearchResult` type.
- `src/hooks/useMessages.ts` (modify) — optional `anchorId` window-load mode + `anchored` flag.
- `src/components/messages/MessageItem.tsx` (modify) — optional `flash` prop → amber highlight.
- `src/components/messages/MessageList.tsx` (modify) — `anchorId` prop: scroll-to-anchor + flash instead of scroll-to-bottom.
- `src/app/(app)/channels/[channelId]/page.tsx` (modify) — search icon in header, right-panel slot precedence, read `?msg=`, "Jump to present".
- `src/components/servers/MessageSearchPanel.tsx` (new) — search input + ✕ + results + Load more + result-click navigation.
- `src/components/servers/SearchSuggestions.tsx` (new) — autocomplete dropdown (members/channels/enums) with keyboard nav.
- `tests/searchQuery.test.ts`, `tests/searchSuggest.test.ts` (new).

---

## Task 1: Query parser (`searchQuery.ts`)

**Files:**
- Create: `src/lib/searchQuery.ts`
- Test: `tests/searchQuery.test.ts`

**Interfaces:**
- Produces:
  - `type ParsedQuery = { text: string; from?: string; in?: string; has?: "link"|"image"|"file"; mentions?: string; pinned?: boolean; beforeTs?: string; afterTs?: string }`
  - `parseSearchQuery(raw: string): ParsedQuery`
  - `type RpcArgs = { text_query: string|null; from_user: string|null; in_channel: string|null; has_type: string|null; before_ts: string|null; after_ts: string|null; mentions_user: string|null; only_pinned: boolean }`
  - `toRpcArgs(parsed: ParsedQuery): RpcArgs`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/searchQuery.test.ts
import { describe, it, expect } from "vitest";
import { parseSearchQuery, toRpcArgs } from "@/lib/searchQuery";

describe("parseSearchQuery", () => {
  it("plain words become text", () => {
    expect(parseSearchQuery("pizza friday").text).toBe("pizza friday");
  });
  it("keeps a quoted phrase intact as text", () => {
    expect(parseSearchQuery('"pizza friday" soon').text).toBe("pizza friday soon");
  });
  it("parses from/in/has/mentions/pinned and strips @ #", () => {
    const p = parseSearchQuery("from:@alex in:#random has:image mentions:@bea pinned:true hi");
    expect(p.from).toBe("alex");
    expect(p.in).toBe("random");
    expect(p.has).toBe("image");
    expect(p.mentions).toBe("bea");
    expect(p.pinned).toBe(true);
    expect(p.text).toBe("hi");
  });
  it("ignores an invalid has: value (treats as text)", () => {
    const p = parseSearchQuery("has:banana");
    expect(p.has).toBeUndefined();
    expect(p.text).toBe("has:banana");
  });
  it("pinned is only true for true/yes/1", () => {
    expect(parseSearchQuery("pinned:false").pinned).toBeUndefined();
    expect(parseSearchQuery("pinned:yes").pinned).toBe(true);
  });
  it("before/after/during produce day bounds (YYYY-MM-DD)", () => {
    expect(parseSearchQuery("before:2026-09-04").beforeTs).toBe("2026-09-04T00:00:00.000Z");
    expect(parseSearchQuery("after:2026-09-04").afterTs).toBe("2026-09-05T00:00:00.000Z");
    const d = parseSearchQuery("during:2026-09-04");
    expect(d.afterTs).toBe("2026-09-04T00:00:00.000Z");
    expect(d.beforeTs).toBe("2026-09-05T00:00:00.000Z");
  });
  it("during a month spans the whole month (YYYY-MM)", () => {
    const d = parseSearchQuery("during:2026-09");
    expect(d.afterTs).toBe("2026-09-01T00:00:00.000Z");
    expect(d.beforeTs).toBe("2026-10-01T00:00:00.000Z");
  });
  it("drops an invalid date (token becomes text)", () => {
    const p = parseSearchQuery("before:nope");
    expect(p.beforeTs).toBeUndefined();
    expect(p.text).toBe("before:nope");
  });
  it("empty input yields empty text and no operators", () => {
    const p = parseSearchQuery("   ");
    expect(p).toEqual({ text: "" });
  });
});

describe("toRpcArgs", () => {
  it("maps fields and nulls an empty text", () => {
    expect(toRpcArgs({ text: "", from: "alex", pinned: true })).toEqual({
      text_query: null, from_user: "alex", in_channel: null, has_type: null,
      before_ts: null, after_ts: null, mentions_user: null, only_pinned: true,
    });
  });
  it("passes text and date bounds through", () => {
    expect(toRpcArgs({ text: "hi", beforeTs: "2026-09-04T00:00:00.000Z" })).toMatchObject({
      text_query: "hi", before_ts: "2026-09-04T00:00:00.000Z", only_pinned: false,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/searchQuery.test.ts`
Expected: FAIL — `Cannot find module '@/lib/searchQuery'`.

- [ ] **Step 3: Implement `src/lib/searchQuery.ts`**

```ts
export type ParsedQuery = {
  text: string;
  from?: string;
  in?: string;
  has?: "link" | "image" | "file";
  mentions?: string;
  pinned?: boolean;
  beforeTs?: string;
  afterTs?: string;
};

export type RpcArgs = {
  text_query: string | null;
  from_user: string | null;
  in_channel: string | null;
  has_type: string | null;
  before_ts: string | null;
  after_ts: string | null;
  mentions_user: string | null;
  only_pinned: boolean;
};

// Split on whitespace, but keep "quoted phrases" as a single token (quotes stripped, marked as text).
function tokenize(raw: string): { value: string; quoted: boolean }[] {
  const out: { value: string; quoted: boolean }[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    if (m[1] !== undefined) out.push({ value: m[1], quoted: true });
    else out.push({ value: m[2], quoted: false });
  }
  return out;
}

// A day/month bound. Returns { start, next-unit-start } as ISO strings, or null if invalid.
function unitBounds(value: string): { start: string; next: string } | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (day) {
    const y = +day[1], mo = +day[2], d = +day[3];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    // Date.UTC rolls invalid days over (e.g. 2026-02-30), so round-trip check.
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return { start: dt.toISOString(), next: new Date(Date.UTC(y, mo - 1, d + 1)).toISOString() };
  }
  const month = /^(\d{4})-(\d{2})$/.exec(value);
  if (month) {
    const y = +month[1], mo = +month[2];
    if (mo < 1 || mo > 12) return null;
    return {
      start: new Date(Date.UTC(y, mo - 1, 1)).toISOString(),
      next: new Date(Date.UTC(y, mo, 1)).toISOString(),
    };
  }
  return null;
}

export function parseSearchQuery(raw: string): ParsedQuery {
  const parsed: ParsedQuery = { text: "" };
  const textParts: string[] = [];

  for (const tok of tokenize(raw)) {
    const idx = tok.quoted ? -1 : tok.value.indexOf(":");
    if (idx <= 0) {
      textParts.push(tok.value);
      continue;
    }
    const key = tok.value.slice(0, idx).toLowerCase();
    const val = tok.value.slice(idx + 1);
    let handled = true;
    switch (key) {
      case "from": parsed.from = val.replace(/^@/, ""); break;
      case "mentions": parsed.mentions = val.replace(/^@/, ""); break;
      case "in": parsed.in = val.replace(/^#/, ""); break;
      case "has":
        if (val === "link" || val === "image" || val === "file") parsed.has = val;
        else handled = false;
        break;
      case "pinned":
        if (val === "true" || val === "yes" || val === "1") parsed.pinned = true;
        else handled = false;
        break;
      case "before": {
        const b = unitBounds(val);
        if (b) parsed.beforeTs = b.start; else handled = false;
        break;
      }
      case "after": {
        const b = unitBounds(val);
        if (b) parsed.afterTs = b.next; else handled = false;
        break;
      }
      case "during": {
        const b = unitBounds(val);
        if (b) { parsed.afterTs = b.start; parsed.beforeTs = b.next; } else handled = false;
        break;
      }
      default: handled = false;
    }
    if (!handled) textParts.push(tok.value);
  }

  parsed.text = textParts.join(" ");
  return parsed;
}

export function toRpcArgs(p: ParsedQuery): RpcArgs {
  return {
    text_query: p.text.trim() ? p.text : null,
    from_user: p.from ?? null,
    in_channel: p.in ?? null,
    has_type: p.has ?? null,
    before_ts: p.beforeTs ?? null,
    after_ts: p.afterTs ?? null,
    mentions_user: p.mentions ?? null,
    only_pinned: p.pinned ?? false,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/searchQuery.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/searchQuery.ts tests/searchQuery.test.ts
git commit -m "feat: message search query parser (operators + date bounds)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Autocomplete helpers (`searchSuggest.ts`)

**Files:**
- Create: `src/lib/searchSuggest.ts`
- Test: `tests/searchSuggest.test.ts`

**Interfaces:**
- Produces:
  - `type SuggestKind = "operator"|"from"|"mentions"|"in"|"has"|"pinned"|"date"|null`
  - `activeToken(raw: string, caret: number): { token: string; start: number; end: number }`
  - `suggestKind(token: string): { kind: SuggestKind; partial: string }`
  - `applySuggestion(raw: string, caret: number, value: string): { raw: string; caret: number }`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/searchSuggest.test.ts
import { describe, it, expect } from "vitest";
import { activeToken, suggestKind, applySuggestion } from "@/lib/searchSuggest";

describe("activeToken", () => {
  it("finds the token the caret sits inside", () => {
    expect(activeToken("from:al in:x", 7)).toEqual({ token: "from:al", start: 0, end: 7 });
  });
  it("finds a later token by caret position", () => {
    expect(activeToken("from:al in:x", 11)).toEqual({ token: "in:x", start: 8, end: 12 });
  });
  it("empty input yields an empty token", () => {
    expect(activeToken("", 0)).toEqual({ token: "", start: 0, end: 0 });
  });
});

describe("suggestKind", () => {
  it("no colon → operator suggestions", () => {
    expect(suggestKind("fr")).toEqual({ kind: "operator", partial: "fr" });
  });
  it("from:/mentions: strip a leading @", () => {
    expect(suggestKind("from:@al")).toEqual({ kind: "from", partial: "al" });
    expect(suggestKind("mentions:be")).toEqual({ kind: "mentions", partial: "be" });
  });
  it("in: strips a leading #", () => {
    expect(suggestKind("in:#ran")).toEqual({ kind: "in", partial: "ran" });
  });
  it("has/pinned/date classified", () => {
    expect(suggestKind("has:im").kind).toBe("has");
    expect(suggestKind("pinned:").kind).toBe("pinned");
    expect(suggestKind("before:2026").kind).toBe("date");
  });
  it("unknown key → null", () => {
    expect(suggestKind("wat:x").kind).toBeNull();
  });
});

describe("applySuggestion", () => {
  it("replaces the active token and moves the caret to its end", () => {
    expect(applySuggestion("hello fr", 8, "from:")).toEqual({ raw: "hello from:", caret: 11 });
  });
  it("replaces a value token including a trailing space", () => {
    expect(applySuggestion("has:im", 6, "has:image ")).toEqual({ raw: "has:image ", caret: 10 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/searchSuggest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/searchSuggest.ts`**

```ts
export type SuggestKind =
  | "operator" | "from" | "mentions" | "in" | "has" | "pinned" | "date" | null;

export function activeToken(raw: string, caret: number): { token: string; start: number; end: number } {
  let start = caret;
  let end = caret;
  while (start > 0 && !/\s/.test(raw[start - 1])) start--;
  while (end < raw.length && !/\s/.test(raw[end])) end++;
  return { token: raw.slice(start, end), start, end };
}

export function suggestKind(token: string): { kind: SuggestKind; partial: string } {
  const idx = token.indexOf(":");
  if (idx <= 0) return { kind: "operator", partial: token };
  const key = token.slice(0, idx).toLowerCase();
  const val = token.slice(idx + 1);
  switch (key) {
    case "from": return { kind: "from", partial: val.replace(/^@/, "") };
    case "mentions": return { kind: "mentions", partial: val.replace(/^@/, "") };
    case "in": return { kind: "in", partial: val.replace(/^#/, "") };
    case "has": return { kind: "has", partial: val };
    case "pinned": return { kind: "pinned", partial: val };
    case "before":
    case "after":
    case "during": return { kind: "date", partial: val };
    default: return { kind: null, partial: val };
  }
}

export function applySuggestion(
  raw: string, caret: number, value: string
): { raw: string; caret: number } {
  const { start, end } = activeToken(raw, caret);
  return { raw: raw.slice(0, start) + value + raw.slice(end), caret: start + value.length };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/searchSuggest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/searchSuggest.ts tests/searchSuggest.test.ts
git commit -m "feat: search autocomplete token helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Migration — FTS column + `search_messages` RPC

**Files:**
- Create: `supabase/migrations/0020_message_search.sql`

**Interfaces:**
- Produces the RPC `public.search_messages(srv uuid, text_query text, from_user text, in_channel text, has_type text, before_ts timestamptz, after_ts timestamptz, mentions_user text, only_pinned boolean, lim int, off_n int)` returning `table(id uuid, channel_id uuid, channel_name text, author_id uuid, author_username text, author_display_name text, author_avatar_url text, content text, image_url text, file_url text, file_name text, pinned boolean, created_at timestamptz)`.

> **Security-critical (controller diffs this file verbatim vs the plan before applying):** keep the `is_server_member(srv)` guard, `c.server_id = srv` scoping, `security definer set search_path = public`, and `grant execute … to authenticated`. Reuses `public.is_server_member(uuid)` (`supabase/migrations/0005_servers.sql:47-50`).

- [ ] **Step 1: Write the migration**

```sql
-- 0020_message_search.sql — full-text search over server channel messages.

-- 1. Generated tsvector column + GIN index (auto-recomputes on content edit).
alter table public.messages
  add column if not exists content_tsv tsvector
  generated always as (to_tsvector('english', coalesce(content, ''))) stored;

create index if not exists messages_content_tsv_idx
  on public.messages using gin (content_tsv);

-- 2. Search RPC. SECURITY DEFINER so it can read across the server's channels, but it
--    first checks the caller is a member of the server (defence in depth atop RLS) and
--    only ever reads channels where c.server_id = srv.
create or replace function public.search_messages(
  srv           uuid,
  text_query    text        default null,
  from_user     text        default null,
  in_channel    text        default null,
  has_type      text        default null,
  before_ts     timestamptz default null,
  after_ts      timestamptz default null,
  mentions_user text        default null,
  only_pinned   boolean     default false,
  lim           int         default 25,
  off_n         int         default 0
) returns table (
  id uuid, channel_id uuid, channel_name text,
  author_id uuid, author_username text, author_display_name text, author_avatar_url text,
  content text, image_url text, file_url text, file_name text,
  pinned boolean, created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.channel_id, c.name,
         m.author_id, p.username, p.display_name, p.avatar_url,
         m.content, m.image_url, m.file_url, m.file_name,
         m.pinned, m.created_at
  from public.messages m
  join public.channels c on c.id = m.channel_id
  join public.profiles p on p.id = m.author_id
  where c.server_id = srv
    and public.is_server_member(srv)
    and (text_query is null or m.content_tsv @@ websearch_to_tsquery('english', text_query))
    and (from_user is null or p.username = from_user)
    and (in_channel is null or c.name = in_channel)
    and (has_type is null
         or (has_type = 'link'  and m.content ~* 'https?://')
         or (has_type = 'image' and m.image_url is not null)
         or (has_type = 'file'  and m.file_url  is not null))
    and (before_ts is null or m.created_at <  before_ts)
    and (after_ts  is null or m.created_at >= after_ts)
    and (mentions_user is null or m.content ~* ('@' || mentions_user || '\y'))
    and (not only_pinned or m.pinned)
  order by m.created_at desc
  limit greatest(1, least(lim, 50)) offset greatest(0, off_n);
$$;

grant execute on function public.search_messages(
  uuid, text, text, text, text, timestamptz, timestamptz, text, boolean, int, int
) to authenticated;
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db push`
Expected: applies `0020_message_search.sql` with no error. Then `npx supabase migration list` shows `0020` on the remote.

- [ ] **Step 3: Smoke-test the RPC**

In the Supabase SQL editor (or `psql`), as an authenticated context isn't available here, verify the function exists and returns the right shape:
Run: `select * from public.search_messages('00000000-0000-0000-0000-000000000000'::uuid, 'hello');`
Expected: 0 rows (nobody is a member of a nil server), no error — proves the signature, guard, and `websearch_to_tsquery` path compile. Real result correctness is covered in the Task 6 manual pass.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0020_message_search.sql
git commit -m "feat: message full-text search migration (tsvector + search_messages RPC)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `SearchResult` type + `searchMessages` wrapper

**Files:**
- Modify: `src/types/db.ts` (append a type)
- Create: `src/lib/search.ts`

**Interfaces:**
- Consumes: `parseSearchQuery`, `toRpcArgs` (Task 1); RPC `search_messages` (Task 3).
- Produces:
  - `type SearchResult` (mirrors the RPC return columns).
  - `searchMessages(supabase: SupabaseClient, serverId: string, parsed: ParsedQuery, page: { lim: number; off: number }): Promise<SearchResult[]>`

- [ ] **Step 1: Add the `SearchResult` type to `src/types/db.ts`**

Append:
```ts
export type SearchResult = {
  id: string;
  channel_id: string;
  channel_name: string;
  author_id: string;
  author_username: string;
  author_display_name: string;
  author_avatar_url: string | null;
  content: string | null;
  image_url: string | null;
  file_url: string | null;
  file_name: string | null;
  pinned: boolean;
  created_at: string;
};
```

- [ ] **Step 2: Implement `src/lib/search.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SearchResult } from "@/types/db";
import { toRpcArgs, type ParsedQuery } from "@/lib/searchQuery";

export async function searchMessages(
  supabase: SupabaseClient,
  serverId: string,
  parsed: ParsedQuery,
  page: { lim: number; off: number }
): Promise<SearchResult[]> {
  const args = toRpcArgs(parsed);
  const { data, error } = await supabase.rpc("search_messages", {
    srv: serverId,
    ...args,
    lim: page.lim,
    off_n: page.off,
  });
  if (error) throw error;
  return (data as SearchResult[]) ?? [];
}
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors. (If `@supabase/supabase-js` types aren't importable as shown, match the client type already used in the repo — e.g. `ReturnType<typeof createClient>` from `@/lib/supabase/client`.)

- [ ] **Step 4: Commit**

```bash
git add src/types/db.ts src/lib/search.ts
git commit -m "feat: SearchResult type + searchMessages RPC wrapper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Anchor / jump-to-message mechanism

Makes `/channels/<id>?msg=<messageId>` load a window around that message, scroll to it, and flash it — with a "Jump to present" escape. This is the jump target the search panel (Task 6) will link to.

**Files:**
- Modify: `src/hooks/useMessages.ts`
- Modify: `src/components/messages/MessageItem.tsx`
- Modify: `src/components/messages/MessageList.tsx`
- Modify: `src/app/(app)/channels/[channelId]/page.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `useMessages` accepts `{ channelId: string; anchorId?: string | null }` (DM variant unchanged) and returns `{ messages, addPending, removePending, anchored: boolean }`.
  - `MessageList` accepts a new optional prop `anchorId?: string | null`.
  - `MessageItem` accepts a new optional prop `flash?: boolean`.

- [ ] **Step 1: Add anchor window-load to `useMessages.ts`**

Change the `Target` type and `load()`. Replace the type (line 7) and the `load` function (lines 25-33), and add `anchorId` to the effect deps + the return value.

```ts
type Target =
  | { channelId: string; anchorId?: string | null }
  | { conversationId: string };
```

`load()` becomes:
```ts
    async function load() {
      const anchorId = "channelId" in target ? target.anchorId ?? null : null;
      if (anchorId) {
        const { data: anchor } = await supabase
          .from("messages").select("created_at").eq("id", anchorId).maybeSingle();
        if (anchor?.created_at) {
          const at = anchor.created_at as string;
          const [before, after] = await Promise.all([
            supabase.from("messages").select("*").eq(column, value)
              .lte("created_at", at).order("created_at", { ascending: false }).limit(50),
            supabase.from("messages").select("*").eq(column, value)
              .gt("created_at", at).order("created_at", { ascending: true }).limit(50),
          ]);
          if (active) setMessages([...((before.data ?? []) as Message[]).reverse(), ...((after.data ?? []) as Message[])]);
          return;
        }
        // anchor not readable → fall through to recent load
      }
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq(column, value)
        .order("created_at", { ascending: true })
        .limit(200);
      if (active) setMessages(data ?? []);
    }
```

Add `anchorId` to the effect dependency array and the return:
```ts
  const anchorId = "channelId" in target ? target.anchorId ?? null : null;
  // ...in the effect deps: [supabase, column, value, anchorId]
  return { messages, addPending, removePending, anchored: !!anchorId };
```
(Define `anchorId` once near the top with `column`/`value`, and use it in the deps array so switching anchors reloads.)

- [ ] **Step 2: Add a `flash` prop to `MessageItem.tsx`**

Add `flash?: boolean;` to the props type (near line 49, after `authorColor`), and OR it into the highlight class (line 122-123):
```tsx
        highlighted || flash ? "bg-amber/10 border-l-2 border-amber" : ""
```
Destructure `flash` in the component's params alongside the other props.

- [ ] **Step 3: Anchor-aware scroll + flash in `MessageList.tsx`**

Add `anchorId?: string | null` to the props type. Add flash state and replace the scroll effect (lines 39-41):
```tsx
  const [flashId, setFlashId] = useState<string | null>(null);

  useEffect(() => {
    if (anchorId) {
      const el = document.getElementById(`msg-${anchorId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setFlashId(anchorId);
        const t = setTimeout(() => setFlashId(null), 2000);
        return () => clearTimeout(t);
      }
    } else {
      bottom.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, anchorId]);
```
Pass `flash={m.id === flashId}` to `<MessageItem>` in the map.

- [ ] **Step 4: Wire `?msg=` + "Jump to present" in the channel page**

In `src/app/(app)/channels/[channelId]/page.tsx`:
- Import `useSearchParams`, `useRouter`, `usePathname` from `next/navigation`.
- In `ChannelView`, read the anchor and pass it down:
```tsx
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const anchorId = searchParams.get("msg");
  const { messages, addPending, removePending, anchored } = useMessages({ channelId: channel.id, anchorId });
```
- Pass `anchorId={anchorId}` to `<MessageList>`.
- When the user sends a message while anchored, or clicks "Jump to present", clear the param:
```tsx
  function jumpToPresent() { router.replace(pathname); }
```
- Render a floating button when `anchored`, above the composer:
```tsx
  {anchored && (
    <button onClick={jumpToPresent}
      className="absolute bottom-20 right-6 z-10 rounded-full bg-accent text-white text-xs px-3 py-1.5 shadow hover:opacity-90">
      Jump to present ↓
    </button>
  )}
```
(The `MessageDropZone` wrapper is `relative`/`flex flex-col`; if it isn't `relative`, add `relative` to its `className` so the absolute button anchors to it.)

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, open a channel with >50 messages.
- Copy an **old** message's id (from the DOM `id="msg-<uuid>"` or DB) and visit `/channels/<channelId>?msg=<oldId>`.
- Expected: the list loads centered on that message, scrolls to it, and it flashes amber for ~2s; a "Jump to present ↓" button appears; clicking it returns to the live bottom-of-channel view.
- Visit `/channels/<channelId>?msg=<garbage>`: falls back to the normal recent view (no crash).

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useMessages.ts src/components/messages/MessageItem.tsx src/components/messages/MessageList.tsx "src/app/(app)/channels/[channelId]/page.tsx"
git commit -m "feat: jump-to-message anchor mode (window load + flash + jump-to-present)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Search panel — header icon, slot, results, jump

**Files:**
- Create: `src/components/servers/MessageSearchPanel.tsx`
- Modify: `src/app/(app)/channels/[channelId]/page.tsx`

**Interfaces:**
- Consumes: `parseSearchQuery` (Task 1), `searchMessages` + `SearchResult` (Task 4), the `?msg=` jump (Task 5).
- Produces: `<MessageSearchPanel serverId={string} onClose={() => void} />`.

- [ ] **Step 1: Add the search icon + slot precedence to the channel header**

In `src/app/(app)/channels/[channelId]/page.tsx` (`ChannelView`):
- Import `MagnifyingGlass` from `@phosphor-icons/react` and `MessageSearchPanel`.
- Add state `const [showSearch, setShowSearch] = useState(false);`.
- Add a button right of the Members button:
```tsx
  <button onClick={() => setShowSearch((s) => !s)}
    className="text-xs font-normal text-muted hover:text-ink ml-3 flex items-center gap-1" title="Search">
    <MagnifyingGlass size={16} /> Search
  </button>
```
- Replace the right-panel render (currently `{showMembers && <MembersPanel .../>}`) with precedence:
```tsx
  {showSearch
    ? <MessageSearchPanel serverId={channel.server_id} onClose={() => setShowSearch(false)} />
    : showMembers
    ? <MembersPanel serverId={channel.server_id} onClose={() => setShowMembers(false)} />
    : null}
```
(Search takes precedence; Members state persists so it returns when search closes.)

- [ ] **Step 2: Implement `MessageSearchPanel.tsx` (input + ✕ + results + Load more + jump)**

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseSearchQuery } from "@/lib/searchQuery";
import { searchMessages } from "@/lib/search";
import type { SearchResult } from "@/types/db";
import { Avatar } from "@/components/user/Avatar";
import { MagnifyingGlass, X, Hash } from "@phosphor-icons/react";

const PAGE = 25;

export function MessageSearchPanel({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const pathname = usePathname();
  const [raw, setRaw] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false); // no more pages
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Debounced fresh search whenever the query changes.
  useEffect(() => {
    const q = raw.trim();
    if (!q) { setResults([]); setError(null); setDone(false); return; }
    let active = true;
    const t = setTimeout(async () => {
      setBusy(true); setError(null);
      try {
        const rows = await searchMessages(supabase, serverId, parseSearchQuery(raw), { lim: PAGE, off: 0 });
        if (active) { setResults(rows); setDone(rows.length < PAGE); }
      } catch { if (active) setError("Search failed"); }
      finally { if (active) setBusy(false); }
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [raw, serverId, supabase]);

  async function loadMore() {
    setBusy(true);
    try {
      const rows = await searchMessages(supabase, serverId, parseSearchQuery(raw), { lim: PAGE, off: results.length });
      setResults((prev) => [...prev, ...rows]);
      setDone(rows.length < PAGE);
    } catch { setError("Search failed"); }
    finally { setBusy(false); }
  }

  function jumpTo(r: SearchResult) {
    const dest = `/channels/${r.channel_id}?msg=${r.id}`;
    // Same channel → replace (re-anchors in place); different channel → push (navigates).
    if (pathname === `/channels/${r.channel_id}`) router.replace(dest);
    else router.push(dest);
  }

  return (
    <aside className="w-72 bg-sidebar border-l border-line flex flex-col">
      <div className="p-2 border-b border-line flex items-center gap-2">
        <div className="relative flex-1">
          <MagnifyingGlass size={15} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <input
            ref={inputRef}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="Search"
            className="w-full pl-8 pr-2 py-1.5 rounded bg-surface-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <button onClick={onClose} aria-label="Close search" className="text-muted hover:text-ink">
          <X size={16} weight="bold" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
        {!raw.trim() && <p className="text-muted text-xs p-2">Search this server. Try <code>from:name</code>, <code>has:image</code>, <code>before:2026-09</code>.</p>}
        {error && <p className="text-danger text-xs p-2">{error}</p>}
        {raw.trim() && !busy && !error && results.length === 0 && <p className="text-muted text-xs p-2">No results.</p>}
        {results.map((r) => (
          <button key={r.id} onClick={() => jumpTo(r)}
            className="text-left p-2 rounded hover:bg-surface flex flex-col gap-1">
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <Avatar url={r.author_avatar_url} name={r.author_display_name} size="sm" />
              <span className="text-ink font-medium">{r.author_display_name}</span>
              <Hash size={11} />{r.channel_name}
              <span className="ml-auto">{new Date(r.created_at).toLocaleDateString()}</span>
            </span>
            <span className="text-sm text-ink line-clamp-3">
              {r.content || (r.image_url ? "🖼️ image" : r.file_name ? `📎 ${r.file_name}` : "")}
            </span>
          </button>
        ))}
        {results.length > 0 && !done && (
          <button onClick={loadMore} disabled={busy}
            className="text-xs text-accent hover:underline p-2 disabled:opacity-50">
            {busy ? "Loading…" : "Load more"}
          </button>
        )}
      </div>
    </aside>
  );
}
```
(If `Avatar`'s `size="sm"` is too large in the result row, use the existing size tokens; match `MembersPanel`. `line-clamp-3` and `bg-surface-2` / `text-danger` should already exist as Tailwind tokens — if `text-danger` isn't defined, use the existing error color used in other dialogs, e.g. the class `ForwardDialog` uses for its error line.)

- [ ] **Step 3: Manual verification**

Run: `npm run dev`.
- Click **Search** in a channel header → the right panel shows the search box (autofocused) with an ✕.
- Type a word present in several channels → results appear (newest first), grouped rows with author + `#channel` + date + snippet; "Load more" pages if >25.
- Click a result in **another** channel → navigates there, loads around the message, flashes it (Task 5). Click a result in the **current** channel → re-anchors without a full reload.
- With Members open, clicking Search replaces the member list; ✕ closes search and Members returns; if Members was closed, ✕ closes the panel.
- Try operators: `from:<username>`, `in:#<channel>`, `has:image`, `pinned:true`, `before:2026-10` — each narrows results correctly.

- [ ] **Step 4: Commit**

```bash
git add src/components/servers/MessageSearchPanel.tsx "src/app/(app)/channels/[channelId]/page.tsx"
git commit -m "feat: message search panel with results + jump-to-message

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Operator autocomplete dropdown

**Files:**
- Create: `src/components/servers/SearchSuggestions.tsx`
- Modify: `src/components/servers/MessageSearchPanel.tsx`

**Interfaces:**
- Consumes: `activeToken`, `suggestKind`, `applySuggestion` (Task 2); server members + channels data.
- Produces: `<SearchSuggestions raw caret members channels onPick />` where `onPick(next: { raw: string; caret: number }) => void`.

- [ ] **Step 1: Fetch members + channels in `MessageSearchPanel`**

Add state and a load effect (mirrors `MembersPanel` for members and `ForwardDialog` for channels):
```tsx
  const [members, setMembers] = useState<{ id: string; username: string; display_name: string; avatar_url: string | null }[]>([]);
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([]);
  const [caret, setCaret] = useState(0);
  const [acOpen, setAcOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: m } = await supabase
        .from("server_members").select("profiles(id, username, display_name, avatar_url)").eq("server_id", serverId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setMembers(((m ?? []) as any[]).map((r) => r.profiles).filter(Boolean));
      const { data: c } = await supabase.from("channels").select("id, name").eq("server_id", serverId).order("position");
      setChannels((c as { id: string; name: string }[]) ?? []);
    })();
  }, [supabase, serverId]);
```
Track the caret from the input: on `onChange`/`onKeyUp`/`onClick`, set `setCaret(e.currentTarget.selectionStart ?? raw.length)` and `setAcOpen(true)`.

- [ ] **Step 2: Implement `SearchSuggestions.tsx`**

```tsx
"use client";

import { useMemo, useState, useEffect } from "react";
import { activeToken, suggestKind, applySuggestion } from "@/lib/searchSuggest";
import { Avatar } from "@/components/user/Avatar";
import { Hash } from "@phosphor-icons/react";

const OPERATORS = [
  { key: "from:", hint: "messages from a user" },
  { key: "mentions:", hint: "mentions a user" },
  { key: "in:", hint: "in a channel" },
  { key: "has:", hint: "link / image / file" },
  { key: "before:", hint: "before a date" },
  { key: "after:", hint: "after a date" },
  { key: "during:", hint: "on a date" },
  { key: "pinned:", hint: "pinned messages" },
];

type Member = { id: string; username: string; display_name: string; avatar_url: string | null };
type Channel = { id: string; name: string };
export type Suggestion = { value: string; label: React.ReactNode };

export function SearchSuggestions({
  raw, caret, members, channels, onPick,
}: {
  raw: string; caret: number; members: Member[]; channels: Channel[];
  onPick: (next: { raw: string; caret: number }) => void;
}) {
  const { token } = activeToken(raw, caret);
  const { kind, partial } = suggestKind(token);
  const lower = partial.toLowerCase();

  const suggestions: Suggestion[] = useMemo(() => {
    switch (kind) {
      case "operator":
        return OPERATORS.filter((o) => o.key.startsWith(lower)).map((o) => ({
          value: o.key, label: <span><code>{o.key}</code> <span className="text-muted">{o.hint}</span></span>,
        }));
      case "from":
      case "mentions": {
        const prefix = kind; // "from" | "mentions"
        return members
          .filter((m) => m.username.toLowerCase().includes(lower) || m.display_name.toLowerCase().includes(lower))
          .slice(0, 8)
          .map((m) => ({
            value: `${prefix}:${m.username} `,
            label: <span className="flex items-center gap-1.5"><Avatar url={m.avatar_url} name={m.display_name} size="sm" />{m.display_name} <span className="text-muted">@{m.username}</span></span>,
          }));
      }
      case "in":
        return channels
          .filter((c) => c.name.toLowerCase().includes(lower))
          .slice(0, 8)
          .map((c) => ({ value: `in:${c.name} `, label: <span className="flex items-center gap-1"><Hash size={12} />{c.name}</span> }));
      case "has":
        return ["link", "image", "file"].filter((v) => v.startsWith(lower)).map((v) => ({ value: `has:${v} `, label: <code>has:{v}</code> }));
      case "pinned":
        return [{ value: "pinned:true ", label: <code>pinned:true</code> }];
      case "date":
        return [{ value: token, label: <span className="text-muted">format: YYYY-MM-DD or YYYY-MM</span> }];
      default:
        return [];
    }
  }, [kind, lower, members, channels, token]);

  const [active, setActive] = useState(0);
  useEffect(() => { setActive(0); }, [token]);

  if (suggestions.length === 0) return null;

  return (
    <ul className="absolute left-0 right-0 top-full mt-1 z-20 bg-surface border border-line rounded shadow max-h-60 overflow-y-auto">
      {suggestions.map((s, i) => (
        <li key={i}>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); if (kind !== "date") onPick(applySuggestion(raw, caret, s.value)); }}
            className={`w-full text-left px-2 py-1.5 text-sm ${i === active ? "bg-surface-2" : ""} hover:bg-surface-2`}
          >
            {s.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
```
(`Suggestion`/`active` state is also driven by keyboard from the panel — expose `active`/`setActive` if you prefer; simplest is to keep keyboard handling in the panel by lifting `suggestions`. For this plan, keyboard Enter/Tab/↑/↓ is handled in Step 3 by re-deriving the same list; keep the derivation identical.)

To keep the highlighted-row and keyboard logic in one place, move the `suggestions` derivation into a small exported pure function and import it in both the panel (for keyboard) and this component — OR handle all keyboard inside this component via a ref. Implementer's choice; the acceptance criterion is the keyboard behavior in Step 3.

- [ ] **Step 3: Wire the dropdown + keyboard into `MessageSearchPanel`**

- Wrap the input in a `relative` container and render `{acOpen && <SearchSuggestions raw={raw} caret={caret} members={members} channels={channels} onPick={(next) => { setRaw(next.raw); setCaret(next.caret); requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(next.caret, next.caret); }); }} />}`.
- On the input's `onKeyDown`:
  - If the dropdown is open and has suggestions: `ArrowDown`/`ArrowUp` move the highlighted index (preventDefault); `Enter` or `Tab` accept the highlighted suggestion (preventDefault) via the same `onPick` path; `Escape` sets `setAcOpen(false)` (preventDefault, don't close the panel).
  - If the dropdown is closed/empty: `Enter` does nothing special (search already runs on debounce); `Escape` closes the panel (`onClose`).
- Close the dropdown (`setAcOpen(false)`) on input blur (with a small delay so a click registers) and after a successful `onPick` of a value that ends in a space.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, open Search.
- Type `fr` → dropdown lists `from:` (and other operators matching); Enter inserts `from:` and keeps focus.
- Continue typing `from:` → members list appears; type a few letters → filters; ↑/↓ highlight; Enter/Tab inserts `from:<username> `.
- `in:` → channels; `has:` → link/image/file; `pinned:` → true; `before:` → format hint (non-inserting).
- Esc closes the dropdown but not the panel; a second Esc (dropdown already closed) closes search.
- After accepting suggestions, the assembled query runs and returns the expected results.

- [ ] **Step 5: Full suite + build**

Run: `npx vitest run` → all green (incl. Tasks 1-2). Run: `npm run build` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/servers/SearchSuggestions.tsx src/components/servers/MessageSearchPanel.tsx
git commit -m "feat: search operator autocomplete dropdown

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification (whole branch)

- [ ] `npx vitest run` green; `npm run build` clean; `npx tsc --noEmit` clean.
- [ ] Migration `0020` applied to remote (`npx supabase migration list`).
- [ ] **Security review of `0020`** (dedicated pass): `is_server_member(srv)` guard present, `c.server_id = srv` scoping, `security definer set search_path = public`, grant to `authenticated` only, no user text interpolated into SQL (only `websearch_to_tsquery` + bound params). A direct `rpc("search_messages", { srv: <a-server-you're-not-in> })` returns `[]`.
- [ ] Multi-user manual pass (from the spec's Testing section): results respect visibility; every operator + combinations work; autocomplete inserts correctly; jump reaches an old message across channels and flashes it; ✕ restores Members.
```
