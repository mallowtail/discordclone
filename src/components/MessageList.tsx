"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Message, Profile } from "@/types/db";
import { MessageItem } from "@/components/MessageItem";
import { startsNewGroup } from "@/lib/grouping";

export function MessageList({ messages }: { messages: Message[] }) {
  const supabase = createClient();
  const [names, setNames] = useState<Record<string, string>>({});
  const bottom = useRef<HTMLDivElement>(null);

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
        // Show the name + time only at the start of a group: a new author, or
        // the same author after a >7-minute gap. Otherwise messages stack.
        const showHeader = startsNewGroup(messages[i - 1], m);
        return (
          <MessageItem
            key={m.id}
            msg={m}
            authorName={names[m.author_id] ?? "…"}
            showHeader={showHeader}
          />
        );
      })}
      <div ref={bottom} />
    </div>
  );
}
