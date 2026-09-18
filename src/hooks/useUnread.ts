"use client";

import { useCallback, useMemo } from "react";
import { useUnreadContext } from "@/components/providers/UnreadProvider";

/**
 * Per-server view onto the shared `UnreadProvider` context: which of `serverId`'s channels
 * have messages the signed-in user hasn't read yet, plus a `markRead` escape hatch.
 *
 * The channel currently open (tracked once, in the provider, from the URL) is never
 * reported as unread — you can't have unread messages in the thing you're looking at.
 *
 * All loading, subscribing, and degrade-quietly-on-error behavior lives in
 * `UnreadProvider` (mounted once in the app layout) so that every consumer of this hook
 * shares one set of queries and one realtime subscription instead of each opening its own.
 */
export function useUnread(serverId: string | null): {
  isUnread: (channelId: string) => boolean;
  hasAnyUnread: boolean;
  markRead: (channelId: string) => void;
} {
  const { activeChannelId, unreadByChannel, channelServer, markRead: providerMarkRead } = useUnreadContext();

  const isUnread = useCallback(
    (channelId: string) => channelId !== activeChannelId && unreadByChannel[channelId] === true,
    [unreadByChannel, activeChannelId]
  );

  const hasAnyUnread = useMemo(
    () =>
      Object.entries(unreadByChannel).some(
        ([id, isChannelUnread]) => isChannelUnread && id !== activeChannelId && channelServer[id] === serverId
      ),
    [unreadByChannel, channelServer, activeChannelId, serverId]
  );

  const markRead = useCallback((channelId: string) => providerMarkRead(channelId), [providerMarkRead]);

  return { isUnread, hasAnyUnread, markRead };
}
