# Message forwarding (Discord-style) — design

**Date:** 2026-08-14
**Sub-project:** Rich-messaging — message actions. Slice **2 of 2** (1 toolbar + reactions ✅ → **2 Forward**).
**Status:** approved, ready for planning

## Goal

Add a **Forward** action to the message toolbar: pick one or more destinations (channels across your
servers + your DMs) via a searchable multi-select dialog, optionally add a comment, and forward the
message as a **frozen snapshot** that renders as a Discord-style "Forwarded" quoted block in each
destination.

## Decisions (from brainstorming)

- **Multiple destinations**, searchable, multi-select (channels grouped by server + DMs).
- **Snapshot, not a live reference:** the forwarded message stores a frozen copy of the original, so
  it renders standalone even if the original is edited/deleted, and never performs a cross-RLS live
  fetch. The forwarder already has access and is deliberately sharing — a frozen copy is the safe unit.
- **Source label:** `#channel-name` for channel messages, `a direct message` for DMs (keeps the DM's
  other participant private).
- Forwarding an already-forwarded message just snapshots the **visible content** — no infinite nesting.
- **Optional comment** becomes the forwarding message's own `content`.
- Reuses existing message-insert RLS (author = you, member of destination) — **no new policy**.

## Schema — migration `supabase/migrations/0016_forward_snapshot.sql`

```sql
-- A forwarded message carries a frozen snapshot of the original (see ForwardSnapshot in the app).
alter table public.messages
  add column if not exists forward_snapshot jsonb;
```

That is the entire migration. `forward_snapshot` is author-set JSON; the existing INSERT policy on
`messages` (author must be `auth.uid()` and a member of the destination channel/conversation) already
governs who may create these rows. No column is server-validated for content (mirrors how
`image_url`/`file_url` are treated), so the render layer sanitizes on read (below).

## Types — `src/types/db.ts`

```ts
export type ForwardSnapshot = {
  author_id: string;
  content: string;
  image_url: string | null;
  file_url: string | null;
  file_name: string | null;
  source: string; // e.g. "#general" or "a direct message"
};
```
Add `forward_snapshot: ForwardSnapshot | null;` to the `Message` type.

## Pure helper (tested) — `src/lib/forward.ts`

```ts
import type { Message, ForwardSnapshot } from "@/types/db";

/** Freeze the display-relevant fields of `original` into a forward snapshot.
 *  If `original` is itself a forward, snapshot its visible content (no nesting). */
export function buildForwardSnapshot(original: Message, sourceLabel: string): ForwardSnapshot {
  return {
    author_id: original.author_id,
    content: original.content ?? "",
    image_url: original.image_url,
    file_url: original.file_url,
    file_name: original.file_name,
    source: sourceLabel,
  };
}
```
(No special-casing for forwarding a forward: we snapshot the outer message's own author/content —
exactly the "visible content, no nesting" decision.)

## Forward dialog — `src/components/messages/ForwardDialog.tsx`

Props: `{ message: Message; onClose: () => void }`.

**Loads destinations** (once, on mount), for the current user:
- **Channels:** `useServers()` gives the user's `servers` (via `server_members`→`servers(*)`). Query
  `channels` `.in("server_id", serverIds).order("position")`, and group each channel under its server's
  name (`servers.name`). A destination row: `{ kind: "channel", id: channel.id, label: "#"+channel.name,
  group: server.name }`.
- **DMs:** the `DmSidebar` pattern — `conversation_members` for the user's `conversation_id`s, then
  `conversation_members` `.select("conversation_id, profiles(*)").in("conversation_id", ids)` for the
  *other* participants. A destination row: `{ kind: "dm", id: conversation_id, label: other.display_name,
  group: "Direct Messages" }`.

**UI:**
- Modal (same overlay idiom as other dialogs: `fixed inset-0 bg-black/60 … z-50`, inner
  `bg-surface rounded-2xl border border-line`). Title `Forward message` (R1 dialog-title recipe).
- **Search input** at top; filters destinations case-insensitively by `label` (and `group`).
- Scrollable list grouped by `group` (server names, then "Direct Messages"), each row a checkbox +
  label. Selection tracked in a `Set<string>` keyed `"${kind}:${id}"`. Ticked rows highlight.
- **Comment** input ("Add a comment — optional").
- **Forward** button, disabled until ≥1 selected; shows count (`Forward to N`). Busy state while sending.
- Escape / outside-click / ✕ close (existing dialog conventions).

**Source label:** computed inside the dialog from `message`: if `message.channel_id`, find that channel
in the loaded channel list → `#name` (fallback `a channel` if not found); else → `a direct message`.

**Send:** on Forward, build the snapshot once with `buildForwardSnapshot(message, sourceLabel)`, then a
single `supabase.from("messages").insert(rows)` where `rows` is one object per selected destination:
```ts
{ author_id: user.id, content: comment.trim(), forward_snapshot: snapshot,
  channel_id: kind === "channel" ? id : null,
  conversation_id: kind === "dm" ? id : null }
```
On error show an inline message; on success `onClose()`. (Realtime delivers the new messages to each
destination via the existing subscriptions.)

## Render — `src/components/messages/ForwardedBlock.tsx`

Props: `{ snapshot: ForwardSnapshot }`. Shown by `MessageItem` when `msg.forward_snapshot` is present,
**below** the normal `MessageContent` (which renders the optional comment).

- A muted **"Forwarded"** label row with a forward icon (`ArrowBendUpRight`).
- A quoted container (left border like the reply indicator: `border-l-2 border-line pl-3`) containing:
  the original author's **avatar + display name** (fetch the profile by `snapshot.author_id` once —
  profiles are world-readable; reuse `Avatar`), the **source** label (`from {snapshot.source}`), the
  snapshot **content** (plain text, `break-words`), and any **attachment**: an `<img>` when
  `snapshot.image_url` passes the existing `isHttpUrl` guard, or a file link when `snapshot.file_url`
  passes it (mirror `MessageContent`'s sanitization exactly — never render a non-http(s) URL).

## Wiring

- **Toolbar:** `MessageActions` gets a new `onForward: () => void` prop and a **Forward button**
  (`ArrowBendUpRight`) placed **between Reply and the ⋯ menu**. (Reply stays; ⋯ menu unchanged.)
- **`MessageItem`:** holds `const [forwarding, setForwarding] = useState(false)`; passes
  `onForward={() => setForwarding(true)}` to `MessageActions`; renders
  `{forwarding && <ForwardDialog message={msg} onClose={() => setForwarding(false)} />}`; and renders
  `{msg.forward_snapshot && <ForwardedBlock snapshot={msg.forward_snapshot} />}` after `MessageContent`.

## Non-goals

- No "jump to original" from a forwarded block (snapshot only).
- No editing a forwarded snapshot; editing the message edits only the comment (`content`) — unchanged edit flow.
- No forwarding to servers/channels the user can't post to (they simply aren't listed; RLS is the backstop).
- No per-destination success/partial-failure UI beyond one inline error (all-or-nothing insert).
- No nesting of forwarded blocks (snapshot is one level, per decision).

## Testing

- **Unit** (`tests/forward.test.ts`): `buildForwardSnapshot` — copies author_id/content/attachment
  fields + the given source label; empty/null content → `""`; a message that is itself a forward still
  snapshots its own outer fields (no nesting).
- **Migration:** controller diffs `0016_forward_snapshot.sql` verbatim; user/controller applies it
  before manual verification.
- **Build:** `npm run build` clean; `npx vitest run` green (adds forward tests).
- **Manual (localhost):** Forward a **text** message and an **image** message; select **two channels
  + one DM**; once **with** a comment and once **without**. Confirm: each destination shows the comment
  (if any) as normal text plus a "Forwarded" block with the original author, `from #source`, the text,
  and the image; the **original message is untouched**; a non-forward message shows no block; the
  picker's search filters channels + DMs; the Forward button is disabled with nothing selected.

## Operational note

One migration (`0016_forward_snapshot.sql`: a single nullable `jsonb` column), no new dependency, no env
change. Everything else is front-end. Forwarded rows are created under the existing `messages` INSERT
RLS; attachment URLs in snapshots are sanitized with the same `isHttpUrl` guard used by `MessageContent`.
