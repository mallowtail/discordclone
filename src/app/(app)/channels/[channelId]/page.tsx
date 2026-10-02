"use client";

import { Suspense, use, useEffect, useState, type ReactNode } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Channel, Message } from "@/types/db";
import { useMessages } from "@/hooks/useMessages";
import { useUnread } from "@/hooks/useUnread";
import { MessageList } from "@/components/messages/MessageList";
import { MessageInput } from "@/components/messages/MessageInput";
import { MessageDropZone } from "@/components/messages/MessageDropZone";
import { PinnedPanel } from "@/components/messages/PinnedPanel";
import { MembersPanel } from "@/components/servers/MembersPanel";
import { SearchBox, SearchResultsPanel } from "@/components/servers/MessageSearchPanel";
import { useMessageSearch } from "@/components/servers/useMessageSearch";
import { useDrawer } from "@/components/providers/DrawerProvider";
import { PushPin, Users, List } from "@phosphor-icons/react";

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
function HeaderButton({
  label,
  onClick,
  children,
  triggerId,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  triggerId?: string;
}) {
  return (
    <div className="group relative ml-3 flex items-center">
      <button
        onClick={onClick}
        aria-label={label}
        data-trigger={triggerId}
        className="flex items-center justify-center min-h-11 min-w-11 md:min-h-0 md:min-w-0 text-muted hover:text-ink"
      >
        {children}
      </button>
      <span
        className="pointer-events-none absolute left-1/2 top-full z-40 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg
          border border-line bg-surface-2 px-2 py-1 text-xs font-normal text-ink opacity-0 shadow-lg transition-opacity
          group-hover:opacity-100"
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
  const { markRead } = useUnread(channel.server_id);
  const { open: drawerOpen, toggleDrawer } = useDrawer();
  const lastMessageId = messages[messages.length - 1]?.id;

  // Mark this channel read on open, and again whenever a new message arrives while it's
  // the open channel — `lastMessageId` changes each time useMessages' realtime subscription
  // appends a row.
  useEffect(() => {
    markRead(channel.id);
  }, [channel.id, lastMessageId, markRead]);

  function jumpToPresent() {
    router.replace(pathname);
  }
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
          <span className="truncate"># {channel.name}</span>
        </span>
        <span className="flex items-center flex-none">
          <HeaderButton label={`Pinned (${pinned.length})`} triggerId="pins" onClick={() => setShowPins((s) => !s)}>
            <PushPin size={17} />
          </HeaderButton>
          <HeaderButton label="Show Member List" onClick={() => setShowMembers((s) => !s)}>
            <Users size={17} />
          </HeaderButton>
          <SearchBox search={search} />
        </span>
        {showPins && <PinnedPanel pinned={pinned} onClose={() => setShowPins(false)} />}
      </header>
      <div className="flex flex-1 min-h-0 relative">
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
        {search.query.trim() ? (
          <SearchResultsPanel search={search} />
        ) : (
          showMembers && (
            <>
              {/* Below `xl` the members list floats above the chat as a right-anchored overlay
                  (with a dismiss backdrop) instead of an inline column; at `xl`+ it's inline,
                  taking its place in this flex row. Same header toggle drives both. */}
              <div
                className="absolute inset-0 z-30 xl:hidden"
                onClick={() => setShowMembers(false)}
                aria-hidden="true"
              />
              <div className="absolute inset-y-0 right-0 z-40 xl:static xl:inset-auto xl:z-auto">
                <MembersPanel serverId={channel.server_id} />
              </div>
            </>
          )
        )}
      </div>
    </>
  );
}
