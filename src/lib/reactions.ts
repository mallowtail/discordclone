import type { Reaction } from "@/types/db";

export type ReactionPill = { emoji: string; count: number; mine: boolean };

/** Identity of a reaction row — its composite primary key (message_id, user_id, emoji). */
type ReactionKey = Pick<Reaction, "message_id" | "user_id" | "emoji">;
function sameReaction(a: ReactionKey, b: ReactionKey): boolean {
  return a.message_id === b.message_id && a.user_id === b.user_id && a.emoji === b.emoji;
}

/** Append a realtime-inserted reaction unless it's already present (dedupe by PK). Prevents a
 *  double count when the initial fetch and the INSERT event race over the same row. */
export function upsertReaction(rows: Reaction[], row: Reaction): Reaction[] {
  return rows.some((x) => sameReaction(x, row)) ? rows : [...rows, row];
}

/** Remove a reaction by its PK (used for realtime DELETE payloads). */
export function removeReaction(rows: Reaction[], key: ReactionKey): Reaction[] {
  return rows.filter((x) => !sameReaction(x, key));
}

export function aggregateReactions(rows: Reaction[], currentUserId: string): ReactionPill[] {
  const byEmoji = new Map<string, ReactionPill>();
  for (const row of rows) {
    const pill = byEmoji.get(row.emoji) ?? { emoji: row.emoji, count: 0, mine: false };
    pill.count += 1;
    if (row.user_id === currentUserId) pill.mine = true;
    byEmoji.set(row.emoji, pill);
  }
  return [...byEmoji.values()];
}
