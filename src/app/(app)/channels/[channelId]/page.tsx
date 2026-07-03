"use client";

import { use, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Channel, Message } from "@/types/db";
import { useMessages } from "@/hooks/useMessages";
import { MessageList } from "@/components/MessageList";
import { MessageInput } from "@/components/MessageInput";
import { PinnedPanel } from "@/components/PinnedPanel";

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
  const messages = useMessages({ channelId: channel.id });
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [replyToName, setReplyToName] = useState("");
  const [showPins, setShowPins] = useState(false);
  const pinned = messages.filter((m) => m.pinned);
  return (
    <>
      <header className="p-3 border-b border-line font-semibold text-ink flex items-center justify-between relative">
        <span># {channel.name}</span>
        <button onClick={() => setShowPins((s) => !s)} className="text-xs font-normal text-muted hover:text-ink">
          📌 Pinned ({pinned.length})
        </button>
        {showPins && <PinnedPanel pinned={pinned} onClose={() => setShowPins(false)} />}
      </header>
      <MessageList messages={messages} onReply={(m, name) => { setReplyTo(m); setReplyToName(name); }} />
      <MessageInput
        target={{ channel_id: channel.id }}
        placeholder={`Message #${channel.name}`}
        replyTo={replyTo}
        replyToName={replyToName}
        onClearReply={() => setReplyTo(null)}
      />
    </>
  );
}
