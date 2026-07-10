"use client";

import { use, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import type { Profile, Message } from "@/types/db";
import { useMessages } from "@/hooks/useMessages";
import { MessageList } from "@/components/messages/MessageList";
import { MessageInput } from "@/components/messages/MessageInput";
import { PinnedPanel } from "@/components/messages/PinnedPanel";

export default function DmPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = use(params);
  const supabase = createClient();
  const { user } = useAuth();
  const [other, setOther] = useState<Profile | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [replyToName, setReplyToName] = useState("");
  const [showPins, setShowPins] = useState(false);
  const { messages, addPending, removePending } = useMessages({ conversationId });
  const pinned = messages.filter((m) => m.pinned);

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
      <header className="p-3 border-b border-line font-semibold text-ink flex items-center justify-between relative">
        <span>@ {other?.display_name ?? "Direct Message"}</span>
        <button
          onClick={() => setShowPins((s) => !s)}
          className="text-xs font-normal text-muted hover:text-ink"
        >
          📌 Pinned ({pinned.length})
        </button>
        {showPins && <PinnedPanel pinned={pinned} onClose={() => setShowPins(false)} />}
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
        addPending={addPending}
        removePending={removePending}
      />
    </>
  );
}
