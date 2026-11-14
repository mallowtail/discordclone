"use client";

import { Suspense, use, useCallback, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { Message } from "@/types/db";
import { useConversation } from "@/hooks/useConversations";
import { GroupIcon } from "@/components/dms/groups/GroupIcon";
import { GroupMembersPanel } from "@/components/dms/groups/GroupMembersPanel";
import { HeaderButton, SidePanelOverlay, useOverlayMode } from "@/components/ui/SidePanel";
import { useMessages } from "@/hooks/useMessages";
import { usePinnedMessages } from "@/hooks/usePinnedMessages";
import { MessageList, MessageRowSkeleton } from "@/components/messages/list/MessageList";
import { MessageInput } from "@/components/messages/composer/MessageInput";
import { TypingIndicator } from "@/components/messages/list/TypingIndicator";
import { useTyping } from "@/hooks/useTyping";
import { MessageDropZone } from "@/components/messages/composer/MessageDropZone";
import { PinnedPanel } from "@/components/messages/pins/PinnedPanel";
import { useDrawer } from "@/components/providers/DrawerProvider";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { PushPin, List, Users, WarningCircle } from "@phosphor-icons/react";

/** Shown while the search-params-reading view suspends; mirrors the DM header + message area. */
function DmSkeleton() {
  return (
    <>
      <header className="p-3 border-b border-line flex items-center min-w-0">
        <div className="h-[26px] flex items-center">
          <Skeleton className="h-4 w-28" />
        </div>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto py-3" aria-busy="true">
        <MessageRowSkeleton withHeader />
        <MessageRowSkeleton withHeader />
      </div>
    </>
  );
}

export default function DmPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = use(params);
  // `useSearchParams` (for the `?msg=` anchor) sits under a Suspense boundary, per the Next docs.
  return (
    <Suspense fallback={<DmSkeleton />}>
      <DmView conversationId={conversationId} />
    </Suspense>
  );
}

function DmView({ conversationId }: { conversationId: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const anchorId = searchParams.get("msg");
  const { conv, loaded: convLoaded, missing: notFound } = useConversation(conversationId);
  const [showMembers, setShowMembers] = useState(false);
  // Stable: SidePanelOverlay's effect depends on it, and new messages re-render this view.
  const closeMembers = useCallback(() => setShowMembers(false), []);
  const membersOverlayMode = useOverlayMode();
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [replyToName, setReplyToName] = useState("");
  const [showPins, setShowPins] = useState(false);
  const { messages, addPending, removePending, anchored, loadOlder, loadingOlder, olderFailed, hasMore } =
    useMessages({ conversationId, anchorId });
  const typing = useTyping(`typing-dm:${conversationId}`);
  const pinsState = usePinnedMessages({ conversationId }, showPins);
  const closePins = useCallback(() => setShowPins(false), []);
  // Stable so the memoized MessageList skips re-renders driven only by typing-indicator updates.
  const handleReply = useCallback((m: Message, name: string) => {
    setReplyTo(m);
    setReplyToName(name);
  }, []);
  const { open: drawerOpen, toggleDrawer } = useDrawer();


  if (notFound) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          icon={<WarningCircle size={32} weight="bold" aria-hidden="true" />}
          title="Conversation not found"
          description="It may have been deleted, or you're no longer in it."
          action={
            <Link
              href="/dms"
              className="rounded-control bg-accent hover:bg-accent-strong text-white text-body font-medium px-3 py-1.5"
            >
              Back to Direct Messages
            </Link>
          }
        />
      </div>
    );
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
          {!convLoaded || !conv ? (
            <Skeleton className="h-4 w-28" />
          ) : conv.isGroup ? (
            <span className="flex items-center gap-2 min-w-0">
              <GroupIcon />
              <span className="truncate">{conv.label}</span>
              <span className="hidden sm:inline flex-none text-meta font-normal text-muted">{conv.members.length} members</span>
            </span>
          ) : (
            <span className="truncate">@ {conv.label}</span>
          )}
        </span>
        <span className="flex items-center flex-none">
          <button
            onClick={() => setShowPins((s) => !s)}
            data-trigger="pins"
            className="min-h-11 flex-none text-xs font-normal text-muted hover:text-ink flex items-center gap-1"
          >
            <PushPin size={15} /> Pinned ({pinsState.count})
          </button>
          {conv?.isGroup && (
            <HeaderButton label="Show Member List" onClick={() => setShowMembers((s) => !s)}>
              <Users size={17} />
            </HeaderButton>
          )}
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
          target={{ conversation_id: conversationId }}
          addPending={addPending}
          removePending={removePending}
          className="flex-1 flex flex-col min-h-0 min-w-0"
        >
          <MessageList
            messages={messages}
            onReply={handleReply}
            anchorId={anchorId}
            anchored={anchored}
            onLoadOlder={loadOlder}
            loadingOlder={loadingOlder}
            olderFailed={olderFailed}
            hasMore={hasMore}
            startLabel={conv?.isGroup ? `This is the start of ${conv.label}` : "This is the start of your conversation"}
          />
          {anchored && (
            <button
              onClick={() => router.replace(pathname)}
              className="absolute bottom-25 right-6 z-10 rounded-pill bg-accent text-white text-meta leading-4 px-3 py-1.5 shadow hover:opacity-90"
            >
              Jump to present ↓
            </button>
          )}
          <TypingIndicator names={typing.names} />
          <MessageInput
            target={{ conversation_id: conversationId }}
            placeholder={`Message ${conv?.label ?? ""}`}
            replyTo={replyTo}
            replyToName={replyToName}
            onClearReply={() => setReplyTo(null)}
            addPending={addPending}
            removePending={removePending}
            onTyping={(t) => (t ? typing.notifyTyping() : typing.notifyStopped())}
          />
        </MessageDropZone>
      {conv?.isGroup && showMembers && (
        membersOverlayMode ? (
          <>
            <div className="absolute inset-0 z-30" onClick={closeMembers} aria-hidden="true" />
            <div className="absolute inset-y-0 right-0 z-40">
              <SidePanelOverlay label="Group members" onClose={closeMembers}>
                <GroupMembersPanel conv={conv} />
              </SidePanelOverlay>
            </div>
          </>
        ) : (
          <GroupMembersPanel conv={conv} />
        )
      )}
      </div>
    </>
  );
}
