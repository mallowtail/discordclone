import type { Reaction } from "@/types/db";

export type ReactionPill = { emoji: string; count: number; mine: boolean };

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
