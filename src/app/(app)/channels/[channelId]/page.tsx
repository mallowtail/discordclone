"use client";

import { Suspense, use, useCallback, useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { navCache } from "@/lib/cache/navCache";
import type { Channel, Message } from "@/types/db";
import { useMessages } from "@/hooks/useMessages";
import { usePinnedMessages } from "@/hooks/usePinnedMessages";
import { useUnread } from "@/hooks/useUnread";
import { MessageList, MessageRowSkeleton } from "@/components/messages/list/MessageList";
import { MessageInput } from "@/components/messages/composer/MessageInput";
import { TypingIndicator } from "@/components/messages/list/TypingIndicator";
import { useTyping } from "@/hooks/useTyping";
import { MessageDropZone } from "@/components/messages/composer/MessageDropZone";
import { PinnedPanel } from "@/components/messages/pins/PinnedPanel";
import { MembersPanel } from "@/components/servers/members/MembersPanel";
import { SearchBox, SearchResultsPanel } from "@/components/servers/search/MessageSearchPanel";
import { useMessageSearch } from "@/components/servers/search/useMessageSearch";
import { useDrawer } from "@/components/providers/DrawerProvider";
import { HeaderButton, SidePanelOverlay, useOverlayMode } from "@/components/ui/SidePanel";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { PushPin, Users, List, WarningCircle, Hash } from "@phosphor-icons/react";

/** Placeholder for the channel header + first few message rows, shown while the channel itself
 * (not yet its messages) is loading — mirrors `ChannelView`'s header (`p-3 border-b`) and the
 * flex-1 scroll area so nothing shifts once the real header/message list mount. */
function ChannelSkeleton() {
  return (
    <>
      {/* h-[26px] = the real header content height (search box), so total header height matches */}
      <header className="p-3 border-b border-line flex items-center min-w-0">
        <div className="h-[26px] flex items-center">
          <Skeleton className="h-4 w-40" />
        </div>
      </header>
      {/* Same component the message list itself shows next, so the two loading stages share one geometry */}
      <div className="flex-1 min-h-0 overflow-y-auto py-3" aria-busy="true">
        <MessageRowSkeleton withHeader />
        <MessageRowSkeleton withHeader />
      </div>
    </>
  );
}

// Mirrors Drawer.tsx's own FOCUSABLE_SELECTOR (not exported from there) — used by the members
// overlay's focus trap below `xl`, the same contract Modal/Drawer use.
export default function ChannelPage({ params }: { params: Promise<{ channelId: string }> }) {
  const { channelId: id } = use(params);
  const supabase = createClient();
  const [fetched, setFetched] = useState<Channel | null>(null);
  const [missingId, setMissingId] = useState<string | null>(null);
  // Render straight away from the remembered row (sidebar/rail already loaded it) so messages start
  // loading immediately; the fetch below still confirms it and catches deleted channels.
  const channel = fetched?.id === id ? fetched : navCache.getChannel(id) ?? null;
  const missing = missingId === id;

  useEffect(() => {
    let active = true;
    supabase.from("channels").select("*").eq("id", id).single()
      .then(({ data }) => {
        if (!active) return;
        if (data) {
          setFetched(data as Channel);
          navCache.visitChannel(data as Channel);
        } else setMissingId(id);
      });
    return () => { active = false; };
  }, [supabase, id]);

  if (missing) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          icon={<WarningCircle size={32} weight="bold" aria-hidden="true" />}
          title="Channel not found"
          description="It may have been deleted, or you don't have access to it."
          action={
            <Link
              href="/channels/first"
              className="rounded-control bg-accent hover:bg-accent-strong text-white text-body font-medium px-3 py-1.5"
            >
              Go to your channels
            </Link>
          }
        />
      </div>
    );
  }
  if (!channel) return <ChannelSkeleton />;
  return (
    <Suspense fallback={<ChannelSkeleton />}>
      <ChannelView channel={channel} />
    </Suspense>
  );
}

/** Header icon button: shows only the icon, revealing its label as a tooltip on hover/focus. */
function ChannelView({ channel }: { channel: Channel }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const anchorId = searchParams.get("msg");
  const { messages, addPending, removePending, anchored, loadOlder, loadingOlder, olderFailed, hasMore } =
    useMessages({ channelId: channel.id, anchorId });
  const typing = useTyping(`typing-channel:${channel.id}`);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [replyToName, setReplyToName] = useState("");
  const [showPins, setShowPins] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  // Stable identity (same precedent as DrawerProvider's `closeDrawer`): SidePanelOverlay's effect
  // depends on this callback, and `useMessages`' realtime subscription re-renders ChannelView on
  // every incoming message — an inline `() => setShowMembers(false)` would get a new identity
  // each time, tearing the overlay's focus trap/overlayStack registration down and back up on
  // every message while it's open.
  const closeMembers = useCallback(() => setShowMembers(false), []);
  const closePins = useCallback(() => setShowPins(false), []);
  // Stable so the memoized MessageList skips re-renders driven only by typing-indicator updates.
  const handleReply = useCallback((m: Message, name: string) => {
    setReplyTo(m);
    setReplyToName(name);
  }, []);
  const search = useMessageSearch(channel.server_id);
  const pinsState = usePinnedMessages({ channelId: channel.id }, showPins);
  const { markRead } = useUnread(channel.server_id);
  const { open: drawerOpen, toggleDrawer } = useDrawer();
  const lastMessageId = messages[messages.length - 1]?.id;
  // Below `xl` the members list is an overlay; at `xl`+ an inline column (see SidePanel.tsx).
  const membersOverlayMode = useOverlayMode();

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
      <header className="p-3 border-b border-line font-semibold text-ink tracking-tight flex items-center justify-between relative z-10 min-w-0 shadow-[0_1px_3px_rgb(0_0_0/0.35)]">
        <span className="flex items-center gap-1 min-w-0">
          <button
            onClick={toggleDrawer}
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            className="md:hidden -ml-1 flex items-center justify-center w-11 h-11 flex-none text-muted hover:text-ink"
          >
            <List size={20} weight="bold" aria-hidden="true" />
          </button>
          <span className="flex items-center gap-1 min-w-0">
            <Hash size={16} weight="bold" className="flex-none text-muted" aria-hidden="true" />
            <span className="truncate">{channel.name}</span>
          </span>
        </span>
        <span className="flex items-center flex-none">
          <HeaderButton label={`Pinned (${pinsState.count})`} triggerId="pins" onClick={() => setShowPins((s) => !s)}>
            <PushPin size={17} />
          </HeaderButton>
          <HeaderButton label="Show Member List" onClick={() => setShowMembers((s) => !s)}>
            <Users size={17} />
          </HeaderButton>
          <SearchBox search={search} />
        </span>
        {showPins && (
          <PinnedPanel
            pins={pinsState.pins}
            loading={pinsState.loading}
            hasMore={pinsState.hasMore}
            onLoadMore={pinsState.loadMore}
            onClose={closePins}
          />
        )}
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
            onReply={handleReply}
            serverId={channel.server_id}
            anchorId={anchorId}
            anchored={anchored}
            onLoadOlder={loadOlder}
            loadingOlder={loadingOlder}
            olderFailed={olderFailed}
            hasMore={hasMore}
            startLabel={`This is the start of #${channel.name}`}
          />
          {anchored && (
            <button
              onClick={jumpToPresent}
              className="absolute bottom-25 right-6 z-10 rounded-pill bg-accent text-white text-meta leading-4 px-3 py-1.5 shadow hover:opacity-90"
            >
              Jump to present ↓
            </button>
          )}
          <TypingIndicator names={typing.names} />
          <MessageInput
            target={{ channel_id: channel.id }}
            placeholder={`Message #${channel.name}`}
            replyTo={replyTo}
            replyToName={replyToName}
            onClearReply={() => setReplyTo(null)}
            addPending={addPending}
            removePending={removePending}
            onTyping={(t) => (t ? typing.notifyTyping() : typing.notifyStopped())}
          />
        </MessageDropZone>
        {search.query.trim() ? (
          <SearchResultsPanel search={search} />
        ) : (
          showMembers &&
          (membersOverlayMode ? (
            // Below `xl` the members list floats above the chat as a right-anchored overlay
            // with a dismiss backdrop, Escape-to-close, and focus containment (G10) — not an
            // inline column. The same header toggle drives both modes.
            <>
              <div
                className="absolute inset-0 z-30"
                onClick={closeMembers}
                aria-hidden="true"
              />
              <div className="absolute inset-y-0 right-0 z-40">
                <SidePanelOverlay label="Members" onClose={closeMembers}>
                  <MembersPanel serverId={channel.server_id} />
                </SidePanelOverlay>
              </div>
            </>
          ) : (
            // At `xl`+ it's a plain inline column, taking its place in this flex row — no
            // dialog semantics, since it isn't acting as an overlay here.
            <MembersPanel serverId={channel.server_id} />
          ))
        )}
      </div>
    </>
  );
}
