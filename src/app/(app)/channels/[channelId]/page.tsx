"use client";

import { Suspense, use, useEffect, useState, type ReactNode } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Channel, Message } from "@/types/db";
import { useMessages } from "@/hooks/useMessages";
import { MessageList } from "@/components/messages/MessageList";
import { MessageInput } from "@/components/messages/MessageInput";
import { MessageDropZone } from "@/components/messages/MessageDropZone";
import { PinnedPanel } from "@/components/messages/PinnedPanel";
import { MembersPanel } from "@/components/servers/MembersPanel";
import { SearchBox, SearchResultsPanel } from "@/components/servers/MessageSearchPanel";
import { useMessageSearch } from "@/components/servers/useMessageSearch";
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

/** Header icon button: shows only the icon, revealing its label as a tooltip on hover/focus. */
function HeaderButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <div className="group relative ml-3 flex items-center">
      <button onClick={onClick} aria-label={label} className="flex items-center text-muted hover:text-ink">
        {children}
      </button>
      <span
        className="pointer-events-none absolute left-1/2 top-full z-40 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg
          border border-line bg-surface-2 px-2 py-1 text-xs font-normal text-ink opacity-0 shadow-lg transition-opacity
          group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {label}
      </span>
    </div>
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
  const search = useMessageSearch(channel.server_id);
  const pinned = messages.filter((m) => m.pinned);

  function jumpToPresent() {
    router.replace(pathname);
  }
  return (
    <>
      <header className="p-3 border-b border-line font-semibold text-ink tracking-tight flex items-center justify-between relative">
        <span># {channel.name}</span>
        <span className="flex items-center">
          <HeaderButton label={`Pinned (${pinned.length})`} onClick={() => setShowPins((s) => !s)}>
            <PushPin size={17} />
          </HeaderButton>
          <HeaderButton label="Show Member List" onClick={() => setShowMembers((s) => !s)}>
            <Users size={17} />
          </HeaderButton>
          <SearchBox search={search} />
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
        {search.query.trim()
          ? <SearchResultsPanel search={search} />
          : showMembers
          ? <MembersPanel serverId={channel.server_id} onClose={() => setShowMembers(false)} />
          : null}
      </div>
    </>
  );
}
