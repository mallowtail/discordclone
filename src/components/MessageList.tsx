"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Message, Profile } from "@/types/db";
import { MessageItem } from "@/components/MessageItem";
import { startsNewGroup } from "@/lib/grouping";
import { useAuth } from "@/components/providers/AuthProvider";
import { useReactions } from "@/hooks/useReactions";

export function MessageList({
  messages,
  onReply,
}: {
  messages: Message[];
  onReply?: (m: Message, authorName: string) => void;
}) {
  const supabase = createClient();
  const [names, setNames] = useState<Record<string, string>>({});
  const bottom = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const reactionsByMessage = useReactions(messages.map((m) => m.id), user?.id ?? "");
  const byId = new Map(messages.map((m) => [m.id, m]));

  useEffect(() => {
    const missing = [...new Set(messages.map((m) => m.author_id))].filter((id) => !names[id]);
    if (missing.length === 0) return;
    supabase.from("profiles").select("*").in("id", missing).then(({ data }) => {
      const next: Record<string, string> = {};
      (data as Profile[] | null)?.forEach((p) => (next[p.id] = p.display_name));
      setNames((prev) => ({ ...prev, ...next }));
    });
  }, [messages, names, supabase]);

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
            authorName={names[m.author_id] ?? "…"}
            showHeader={showHeader}
            pills={reactionsByMessage[m.id] ?? []}
            repliedTo={repliedTo}
            repliedToName={repliedTo ? names[repliedTo.author_id] : undefined}
            onReply={onReply}
          />
        );
      })}
      <div ref={bottom} />
    </div>
  );
}
