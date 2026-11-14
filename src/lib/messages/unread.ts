import type { Message } from "@/types/db";

/**
 * Count messages that are newer than `lastReadAt` and not authored by `myUserId`.
 * A null/undefined `lastReadAt` means the channel has never been read, so every
 * message not authored by me counts. A message exactly at `lastReadAt` is read,
 * not unread (strict `>` comparison).
 */
export function unreadCount(
  messages: Message[],
  lastReadAt: string | null | undefined,
  myUserId: string
): number {
  const threshold = lastReadAt ? new Date(lastReadAt).getTime() : null;
  let count = 0;
  for (const m of messages) {
    if (m.author_id === myUserId) continue;
    if (threshold === null || new Date(m.created_at).getTime() > threshold) count++;
  }
  return count;
}

/** Boolean form of {@link unreadCount}: true when at least one message is unread. */
export function hasUnread(
  messages: Message[],
  lastReadAt: string | null | undefined,
  myUserId: string
): boolean {
  return unreadCount(messages, lastReadAt, myUserId) > 0;
}
