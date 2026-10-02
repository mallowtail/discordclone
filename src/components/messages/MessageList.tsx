"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Message, Profile } from "@/types/db";
import { MessageItem } from "@/components/messages/MessageItem";
import { startsNewGroup } from "@/lib/grouping";
import { useAuth } from "@/components/providers/AuthProvider";
import { useReactions } from "@/hooks/useReactions";
import { useMemberRoleColors } from "@/hooks/useMemberRoleColors";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ChatCircleDots } from "@phosphor-icons/react";

/**
 * Placeholder for a single message row, shaped to match `MessageItem` so nothing jumps when the
 * real row lands: `withHeader` mirrors a "new group" row (avatar + name-width + one line),
 * `!withHeader` mirrors a continuation row (no avatar, one indented line).
 */
function MessageRowSkeleton({ withHeader }: { withHeader: boolean }) {
  if (!withHeader) {
    return (
      <div className="px-2 md:px-4 flex gap-2 md:gap-3">
        <div className="w-8 md:w-10 flex-none" aria-hidden="true" />
        <Skeleton className="h-3 w-1/3 max-w-xs my-1" />
      </div>
    );
  }
  return (
    <div className="px-2 md:px-4 mt-3 pt-0.5 flex gap-2 md:gap-3">
      <Skeleton className="h-8 w-8 md:h-10 md:w-10 flex-none rounded-pill" />
      <div className="flex-1 min-w-0 flex flex-col gap-2 pt-0.5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-2/3 max-w-sm" />
      </div>
    </div>
  );
}

export function MessageList({
  messages,
  onReply,
  serverId,
  anchorId,
  anchored,
}: {
  messages: Message[];
  onReply?: (m: Message, authorName: string) => void;
  serverId?: string;
  anchorId?: string | null;
  anchored?: boolean;
}) {
  const supabase = createClient();
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [flashId, setFlashId] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const flashedRef = useRef<string | null>(null);
  const { user } = useAuth();
  const reactionsByMessage = useReactions(messages.map((m) => m.id), user?.id ?? "");
  const byId = new Map(messages.map((m) => [m.id, m]));
  const { colorFor } = useMemberRoleColors(serverId);
  // `useMessages` always hands us the exact same `[]` instance on mount, and only ever replaces
  // it with a freshly built array (never mutates in place) once a real fetch or realtime event
  // lands — even when that result is itself zero messages. So comparing against that first
  // reference (captured once on mount, via lazy `useState` rather than a ref — reading a ref's
  // `.current` during render isn't allowed) tells "no data has arrived yet" apart from "arrived,
  // and there's nothing here," which `messages.length === 0` alone can't do.
  const [initialMessages] = useState(() => messages);
  const stillLoading = messages === initialMessages && messages.length === 0;

  useEffect(() => {
    const missing = [...new Set(messages.map((m) => m.author_id))].filter((id) => !profiles[id]);
    if (missing.length === 0) return;
    supabase.from("profiles").select("*").in("id", missing).then(({ data }) => {
      const next: Record<string, Profile> = {};
      (data as Profile[] | null)?.forEach((p) => (next[p.id] = p));
      setProfiles((prev) => ({ ...prev, ...next }));
    });
  }, [messages, profiles, supabase]);

  // scroll to / flash the anchor once per anchorId; otherwise go to present
  useEffect(() => {
    if (anchorId && anchored) {
      if (flashedRef.current === anchorId) return;           // already scrolled+flashed this anchor
      const el = document.getElementById(`msg-${anchorId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setFlashId(anchorId);
        flashedRef.current = anchorId;
      }
      return;                                                // not mounted yet; a later messages update retries
    }
    flashedRef.current = null;                               // reset so returning to an anchor later re-flashes
    bottom.current?.scrollIntoView({ behavior: "smooth" });  // normal / garbage-id path → go to present
  }, [messages, anchorId, anchored]);

  // flash auto-clears after 2s; keyed on flashId so message updates can't cancel it
  useEffect(() => {
    if (!flashId) return;
    const t = setTimeout(() => setFlashId(null), 2000);
    return () => clearTimeout(t);
  }, [flashId]);

  return (
    <div className="flex-1 overflow-y-auto py-3">
      {stillLoading ? (
        // Real content hasn't arrived yet — approximate shape only (we don't know the real
        // message count/length yet), alternating a header-style row in with continuations so it
        // reads as a message list rather than a generic block.
        Array.from({ length: 6 }).map((_, i) => <MessageRowSkeleton key={i} withHeader={i % 3 === 0} />)
      ) : messages.length === 0 ? (
        <EmptyState
          icon={<ChatCircleDots size={32} weight="bold" aria-hidden="true" />}
          title="No messages yet — say something"
        />
      ) : (
        messages.map((m, i) => {
          const showHeader = startsNewGroup(messages[i - 1], m);
          const repliedTo = m.reply_to_id ? byId.get(m.reply_to_id) ?? null : null;
          const authorKnown = !!profiles[m.author_id];
          // Only a header row actually displays the author name, so only it needs to wait on
          // the profile fetch — a continuation row never shows a name regardless, and delaying
          // it too would just hide real message content for no visible benefit.
          if (showHeader && !authorKnown) {
            return <MessageRowSkeleton key={m.id} withHeader />;
          }
          return (
            <MessageItem
              key={m.id}
              msg={m}
              authorName={profiles[m.author_id]?.display_name ?? ""}
              authorAvatar={profiles[m.author_id]?.avatar_url ?? null}
              showHeader={showHeader}
              pills={reactionsByMessage[m.id] ?? []}
              repliedTo={repliedTo}
              repliedToName={repliedTo ? profiles[repliedTo.author_id]?.display_name : undefined}
              onReply={onReply}
              serverId={serverId}
              authorColor={colorFor(m.author_id)}
              flash={m.id === flashId}
            />
          );
        })
      )}
      <div ref={bottom} />
    </div>
  );
}
