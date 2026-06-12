"use client";

import { use, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Channel, Message } from "@/types/db";
import { useMessages } from "@/hooks/useMessages";
import { MessageList } from "@/components/MessageList";
import { MessageInput } from "@/components/MessageInput";

export default function ChannelPage({ params }: { params: Promise<{ channelId: string }> }) {
  const { channelId: name } = use(params);
  const supabase = createClient();
  const [channel, setChannel] = useState<Channel | null>(null);

  useEffect(() => {
    supabase.from("channels").select("*").eq("name", name).single()
      .then(({ data }) => setChannel(data));
  }, [supabase, name]);

  if (!channel) return <div className="p-4 text-[#949ba4]">Loading channel…</div>;
  return <ChannelView channel={channel} />;
}

function ChannelView({ channel }: { channel: Channel }) {
  const messages = useMessages({ channelId: channel.id });
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [replyToName, setReplyToName] = useState("");
  return (
    <>
      <header className="p-3 border-b border-black/30 font-semibold text-white"># {channel.name}</header>
      <MessageList
        messages={messages}
        onReply={(m, name) => {
          setReplyTo(m);
          setReplyToName(name);
        }}
      />
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
