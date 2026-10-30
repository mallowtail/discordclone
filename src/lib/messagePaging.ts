import type { Message } from "@/types/db";

/** How many messages one history page fetches. */
export const MESSAGE_PAGE = 50;

/**
 * Union of two message lists by id, sorted oldest → newest (stable for equal timestamps).
 * An incoming row replaces an existing one with the same id — except a pending (optimistic)
 * row never overwrites a confirmed one. Always returns a new array.
 */
export function mergeMessages(prev: Message[], incoming: Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const m of prev) byId.set(m.id, m);
  for (const m of incoming) {
    const existing = byId.get(m.id);
    if (existing && !existing.pending && m.pending) continue;
    byId.set(m.id, m);
  }
  // Array.prototype.sort is stable, so equal timestamps keep insertion order.
  return [...byId.values()].sort(compareCreatedAt);
}

// Server rows look like `…T10:00:00.123456+00:00`, optimistic rows like `…T10:00:00.123Z`, so
// compare as instants first; same-millisecond ties fall back to the string (microseconds).
function compareCreatedAt(a: Message, b: Message): number {
  const diff = Date.parse(a.created_at) - Date.parse(b.created_at);
  if (diff !== 0 && !Number.isNaN(diff)) return diff;
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
}

/** A page that came back full means there may be more beyond it. */
export function hasMoreAfter(pageLength: number, pageSize: number): boolean {
  return pageLength >= pageSize;
}
