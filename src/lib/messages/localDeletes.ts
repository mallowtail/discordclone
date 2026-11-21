// "I just deleted this message": lets the deleter's own message list drop it at once, without
// waiting for the realtime DELETE event (which can lag, or miss a subscription that isn't up yet).
// Used by the author's own delete and by a moderator's `delete_message_as_mod`.

type Listener = (messageId: string) => void;

const listeners = new Set<Listener>();

/** Tell every open message list that `messageId` is gone. */
export function announceMessageDeleted(messageId: string): void {
  for (const listener of [...listeners]) listener(messageId);
}

/** Listen for messages this tab deleted. Returns the unsubscribe function. */
export function onMessageDeleted(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** `messages` without the one with `id` (the same array when it isn't there, so nothing re-renders). */
export function withoutMessage<T extends { id: string }>(messages: T[], id: string): T[] {
  return messages.some((m) => m.id === id) ? messages.filter((m) => m.id !== id) : messages;
}
