"use client";

import { Suspense, use, useCallback, useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import type { Profile, Message } from "@/types/db";
import { useMessages } from "@/hooks/useMessages";
import { usePinnedMessages } from "@/hooks/usePinnedMessages";
import { MessageList, MessageRowSkeleton } from "@/components/messages/MessageList";
import { MessageInput } from "@/components/messages/MessageInput";
import { TypingIndicator } from "@/components/messages/TypingIndicator";
import { useTyping } from "@/hooks/useTyping";
import { MessageDropZone } from "@/components/messages/MessageDropZone";
import { PinnedPanel } from "@/components/messages/PinnedPanel";
import { useDrawer } from "@/components/providers/DrawerProvider";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { PushPin, List, WarningCircle } from "@phosphor-icons/react";

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
  const supabase = createClient();
  const { user } = useAuth();
  const [other, setOther] = useState<Profile | null>(null);
  const [otherLoaded, setOtherLoaded] = useState(false);
  const [notFound, setNotFound] = useState(false);
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

  useEffect(() => {
    if (!user) return;
    let active = true;
    supabase
      .from("conversation_members")
      .select("profiles(*)")
      .eq("conversation_id", conversationId)
      .neq("user_id", user.id)
      .single()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data, error }: any) => {
        if (!active) return;
        if (error || !data?.profiles) {
          setNotFound(true);
          setOtherLoaded(true);
          return;
        }
        setOther(data.profiles);
        setOtherLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [supabase, conversationId, user]);

  if (notFound) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          icon={<WarningCircle size={32} weight="bold" aria-hidden="true" />}
          title="Conversation not found"
          description="It may have been deleted, or you don't have access to it."
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
          <span className="truncate">
            {otherLoaded ? <>@ {other?.display_name ?? "Direct Message"}</> : <Skeleton className="h-4 w-28" />}
          </span>
        </span>
        <button
          onClick={() => setShowPins((s) => !s)}
          data-trigger="pins"
          className="min-h-11 flex-none text-xs font-normal text-muted hover:text-ink flex items-center gap-1"
        >
          <PushPin size={15} /> Pinned ({pinsState.count})
        </button>
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
      <MessageDropZone
        target={{ conversation_id: conversationId }}
        addPending={addPending}
        removePending={removePending}
        className="flex-1 flex flex-col min-h-0"
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
          startLabel="This is the start of your conversation"
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
          placeholder={`Message ${other?.display_name ?? ""}`}
          replyTo={replyTo}
          replyToName={replyToName}
          onClearReply={() => setReplyTo(null)}
          addPending={addPending}
          removePending={removePending}
          onTyping={(t) => (t ? typing.notifyTyping() : typing.notifyStopped())}
        />
      </MessageDropZone>
    </>
  );
}
