"use client";

import { use, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import type { Profile, Message } from "@/types/db";
import { useMessages } from "@/hooks/useMessages";
import { MessageList } from "@/components/messages/MessageList";
import { MessageInput } from "@/components/messages/MessageInput";
import { MessageDropZone } from "@/components/messages/MessageDropZone";
import { PinnedPanel } from "@/components/messages/PinnedPanel";
import { useDrawer } from "@/components/providers/DrawerProvider";
import { PushPin, List } from "@phosphor-icons/react";

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
  const { open: drawerOpen, toggleDrawer } = useDrawer();

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
      <header className="p-3 border-b border-line font-semibold text-ink tracking-tight flex items-center justify-between relative min-w-0">
        <span className="flex items-center gap-1 min-w-0">
          <button
            onClick={toggleDrawer}
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            className="md:hidden -ml-1 flex items-center justify-center w-11 h-11 flex-none text-muted hover:text-ink"
          >
            <List size={20} weight="bold" aria-hidden="true" />
          </button>
          <span className="truncate">@ {other?.display_name ?? "Direct Message"}</span>
        </span>
        <button
          onClick={() => setShowPins((s) => !s)}
          className="min-h-11 flex-none text-xs font-normal text-muted hover:text-ink flex items-center gap-1"
        >
          <PushPin size={15} /> Pinned ({pinned.length})
        </button>
        {showPins && <PinnedPanel pinned={pinned} onClose={() => setShowPins(false)} />}
      </header>
      <MessageDropZone
        target={{ conversation_id: conversationId }}
        addPending={addPending}
        removePending={removePending}
        className="flex-1 flex flex-col min-h-0"
      >
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
      </MessageDropZone>
    </>
  );
}
