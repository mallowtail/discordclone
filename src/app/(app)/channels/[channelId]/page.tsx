"use client";

import { Suspense, use, useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Channel, Message } from "@/types/db";
import { useMessages } from "@/hooks/useMessages";
import { MessageList } from "@/components/messages/MessageList";
import { MessageInput } from "@/components/messages/MessageInput";
import { MessageDropZone } from "@/components/messages/MessageDropZone";
import { PinnedPanel } from "@/components/messages/PinnedPanel";
import { MembersPanel } from "@/components/servers/MembersPanel";
import { PushPin, Users } from "@phosphor-icons/react";

export default function ChannelPage({ params }: { params: Promise<{ channelId: string }> }) {
  const { channelId: id } = use(params);
  const supabase = createClient();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    supabase.from("channels").select("*").eq("id", id).single()
      .then(({ data }) => {
        if (data) setChannel(data as Channel);
        else setMissing(true);
      });
  }, [supabase, id]);

  if (missing) return <div className="p-4 text-muted">Channel not found.</div>;
  if (!channel) return <div className="p-4 text-muted">Loading channel…</div>;
  return (
    <Suspense fallback={<div className="p-4 text-muted">Loading channel…</div>}>
      <ChannelView channel={channel} />
    </Suspense>
  );
}

function ChannelView({ channel }: { channel: Channel }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const anchorId = searchParams.get("msg");
  const { messages, addPending, removePending, anchored } = useMessages({ channelId: channel.id, anchorId });
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [replyToName, setReplyToName] = useState("");
  const [showPins, setShowPins] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const pinned = messages.filter((m) => m.pinned);

  function jumpToPresent() {
    router.replace(pathname);
  }
  return (
    <>
      <header className="p-3 border-b border-line font-semibold text-ink tracking-tight flex items-center justify-between relative">
        <span># {channel.name}</span>
        <span className="flex items-center">
          <button onClick={() => setShowPins((s) => !s)} className="text-xs font-normal text-muted hover:text-ink flex items-center gap-1">
            <PushPin size={15} /> Pinned ({pinned.length})
          </button>
          <button
            onClick={() => setShowMembers((s) => !s)}
            className="text-xs font-normal text-muted hover:text-ink ml-3 flex items-center gap-1"
          >
            <Users size={16} /> Members
          </button>
        </span>
        {showPins && <PinnedPanel pinned={pinned} onClose={() => setShowPins(false)} />}
      </header>
      <div className="flex flex-1 min-h-0">
        <MessageDropZone
          target={{ channel_id: channel.id }}
          addPending={addPending}
          removePending={removePending}
          className="flex-1 flex flex-col min-w-0"
        >
          <MessageList
            messages={messages}
            onReply={(m, name) => { setReplyTo(m); setReplyToName(name); }}
            serverId={channel.server_id}
            anchorId={anchorId}
            anchored={anchored}
          />
          {anchored && (
            <button
              onClick={jumpToPresent}
              className="absolute bottom-20 right-6 z-10 rounded-full bg-accent text-white text-xs px-3 py-1.5 shadow hover:opacity-90"
            >
              Jump to present ↓
            </button>
          )}
          <MessageInput
            target={{ channel_id: channel.id }}
            placeholder={`Message #${channel.name}`}
            replyTo={replyTo}
            replyToName={replyToName}
            onClearReply={() => setReplyTo(null)}
            addPending={addPending}
            removePending={removePending}
          />
        </MessageDropZone>
        {showMembers && <MembersPanel serverId={channel.server_id} onClose={() => setShowMembers(false)} />}
      </div>
    </>
  );
}
