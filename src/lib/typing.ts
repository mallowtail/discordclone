// Pure helpers for typing indicators (private Realtime broadcast, see useTyping).

export const TYPING_THROTTLE_MS = 2500;
export const TYPING_TTL_MS = 5000;

/** Who is typing, keyed by user id; `at` is when we last heard from them (ms epoch). */
export type Typists = Record<string, { name: string; at: number }>;

/** Human copy for the indicator line. Empty string when nobody is typing. */
export function formatTyping(names: string[]): string {
  switch (names.length) {
    case 0:
      return "";
    case 1:
      return `${names[0]} is typing...`;
    case 2:
      return `${names[0]} and ${names[1]} are typing...`;
    case 3:
      return `${names[0]}, ${names[1]}, and ${names[2]} are typing...`;
    default:
      return "Several people are typing...";
  }
}

/**
 * Drops typists we haven't heard from for `ttlMs` (they closed the tab or lost network without
 * sending "stopped"). Returns the same object when nothing changed so React can skip a re-render.
 */
export function pruneTypists(t: Typists, now: number, ttlMs = TYPING_TTL_MS): Typists {
  let changed = false;
  const next: Typists = {};
  for (const [id, entry] of Object.entries(t)) {
    if (now - entry.at >= ttlMs) changed = true;
    else next[id] = entry;
  }
  return changed ? next : t;
}
