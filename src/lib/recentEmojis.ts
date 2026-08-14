/** Most-recent-first list after using `emoji`: dedupe, unshift, cap at `max` (default 12). */
export function pushRecent(list: string[], emoji: string, max = 12): string[] {
  return [emoji, ...list.filter((x) => x !== emoji)].slice(0, max);
}

const SEED = ["👍", "❤️", "😂"];

/** The three emojis to show in the toolbar: user's recents, padded from SEED, no dupes, length 3. */
export function toolbarRecents(recent: string[]): string[] {
  const out = [...recent];
  for (const s of SEED) {
    if (out.length >= 3) break;
    if (!out.includes(s)) out.push(s);
  }
  return out.slice(0, 3);
}
