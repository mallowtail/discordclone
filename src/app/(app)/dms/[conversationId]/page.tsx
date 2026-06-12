"use client";

import { use, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import type { Profile, Message } from "@/types/db";
import { useMessages } from "@/hooks/useMessages";
import { MessageList } from "@/components/MessageList";
import { MessageInput } from "@/components/MessageInput";

export default function DmPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = use(params);
  const supabase = createClient();
  const { user } = useAuth();
  const [other, setOther] = useState<Profile | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [replyToName, setReplyToName] = useState("");
  const messages = useMessages({ conversationId });

  useEffect(() => {
    if (!user) return;
    supabase
      .from("conversation_members")
      .select("profiles(*)")
      .eq("conversation_id", conversationId)
      .neq("user_id", user.id)
      .single()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data }: any) => setOther(data?.profiles ?? null));
  }, [supabase, conversationId, user]);

  return (
    <>
      <header className="p-3 border-b border-black/30 font-semibold text-white">
        @ {other?.display_name ?? "Direct Message"}
      </header>
      <MessageList
        messages={messages}
        onReply={(m, name) => {
          setReplyTo(m);
          setReplyToName(name);
        }}
      />
      <MessageInput
        target={{ conversation_id: conversationId }}
        placeholder={`Message ${other?.display_name ?? ""}`}
        replyTo={replyTo}
        replyToName={replyToName}
        onClearReply={() => setReplyTo(null)}
      />
    </>
  );
}
