import type { Message } from "@/types/db";

// Consecutive messages from the same author are grouped under one header,
// but a gap longer than this starts a fresh group — like Discord.
export const GROUP_GAP_MS = 7 * 60 * 1000; // 7 minutes

export function startsNewGroup(prev: Message | undefined, curr: Message): boolean {
  if (!prev) return true;
  if (prev.author_id !== curr.author_id) return true;
  const gap = new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime();
  return gap > GROUP_GAP_MS;
}
