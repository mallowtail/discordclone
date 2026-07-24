"use client";

import { use, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Channel, Message } from "@/types/db";
import { useMessages } from "@/hooks/useMessages";
import { MessageList } from "@/components/messages/MessageList";
import { MessageInput } from "@/components/messages/MessageInput";
import { MessageDropZone } from "@/components/messages/MessageDropZone";
import { PinnedPanel } from "@/components/messages/PinnedPanel";
import { MembersPanel } from "@/components/servers/MembersPanel";

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
  return <ChannelView channel={channel} />;
}

function ChannelView({ channel }: { channel: Channel }) {
  const { messages, addPending, removePending } = useMessages({ channelId: channel.id });
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [replyToName, setReplyToName] = useState("");
  const [showPins, setShowPins] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const pinned = messages.filter((m) => m.pinned);
  return (
    <>
      <header className="p-3 border-b border-line font-semibold text-ink flex items-center justify-between relative">
        <span># {channel.name}</span>
        <span className="flex items-center">
          <button onClick={() => setShowPins((s) => !s)} className="text-xs font-normal text-muted hover:text-ink">
            📌 Pinned ({pinned.length})
          </button>
          <button
            onClick={() => setShowMembers((s) => !s)}
            className="text-xs font-normal text-muted hover:text-ink ml-3"
          >
            👥 Members
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
          />
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
