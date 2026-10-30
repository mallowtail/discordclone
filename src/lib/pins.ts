import type { Message } from "@/types/db";

/** Pinned messages fetched per page in the pins panel. */
export const PIN_PAGE = 20;

/** Newest pinned first; rows without a pinned_at sort last. */
function byPinnedAtDesc(a: Message, b: Message): number {
  if (a.pinned_at === b.pinned_at) return 0;
  if (a.pinned_at === null) return 1;
  if (b.pinned_at === null) return -1;
  return b.pinned_at.localeCompare(a.pinned_at);
}

/**
 * Apply a realtime row change to the loaded pins list: a pinned row is upserted by id (never
 * duplicated) and the list re-sorted by `pinned_at` desc; an unpinned row is removed by id
 * (no-op if it wasn't listed).
 */
export function applyPinUpdate(list: Message[], row: Message): Message[] {
  const without = list.filter((m) => m.id !== row.id);
  if (!row.pinned) return without.length === list.length ? list : without;
  return [...without, row].sort(byPinnedAtDesc);
}
