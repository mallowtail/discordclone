"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Message, Profile } from "@/types/db";
import { MessageItem } from "@/components/messages/MessageItem";
import { startsNewGroup } from "@/lib/grouping";
import { useAuth } from "@/components/providers/AuthProvider";
import { useReactions } from "@/hooks/useReactions";
import { useMemberRoleColors } from "@/hooks/useMemberRoleColors";

export function MessageList({
  messages,
  onReply,
  serverId,
}: {
  messages: Message[];
  onReply?: (m: Message, authorName: string) => void;
  serverId?: string;
}) {
  const supabase = createClient();
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const bottom = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const reactionsByMessage = useReactions(messages.map((m) => m.id), user?.id ?? "");
  const byId = new Map(messages.map((m) => [m.id, m]));
  const { colorFor } = useMemberRoleColors(serverId);

  useEffect(() => {
    const missing = [...new Set(messages.map((m) => m.author_id))].filter((id) => !profiles[id]);
    if (missing.length === 0) return;
    supabase.from("profiles").select("*").in("id", missing).then(({ data }) => {
      const next: Record<string, Profile> = {};
      (data as Profile[] | null)?.forEach((p) => (next[p.id] = p));
      setProfiles((prev) => ({ ...prev, ...next }));
    });
  }, [messages, profiles, supabase]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex-1 overflow-y-auto py-3">
      {messages.map((m, i) => {
        const showHeader = startsNewGroup(messages[i - 1], m);
        const repliedTo = m.reply_to_id ? byId.get(m.reply_to_id) ?? null : null;
        return (
          <MessageItem
            key={m.id}
            msg={m}
            authorName={profiles[m.author_id]?.display_name ?? "…"}
            authorAvatar={profiles[m.author_id]?.avatar_url ?? null}
            showHeader={showHeader}
            pills={reactionsByMessage[m.id] ?? []}
            repliedTo={repliedTo}
            repliedToName={repliedTo ? profiles[repliedTo.author_id]?.display_name : undefined}
            onReply={onReply}
            serverId={serverId}
            authorColor={colorFor(m.author_id)}
          />
        );
      })}
      <div ref={bottom} />
    </div>
  );
}
