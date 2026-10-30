"use client";

import { Suspense, use, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Channel, Message } from "@/types/db";
import { useMessages } from "@/hooks/useMessages";
import { useUnread } from "@/hooks/useUnread";
import { MessageList, MessageRowSkeleton } from "@/components/messages/MessageList";
import { MessageInput } from "@/components/messages/MessageInput";
import { MessageDropZone } from "@/components/messages/MessageDropZone";
import { PinnedPanel } from "@/components/messages/PinnedPanel";
import { MembersPanel } from "@/components/servers/MembersPanel";
import { SearchBox, SearchResultsPanel } from "@/components/servers/MessageSearchPanel";
import { useMessageSearch } from "@/components/servers/useMessageSearch";
import { useDrawer } from "@/components/providers/DrawerProvider";
import { pushOverlay, popOverlay, isTopOverlay, claimEscape } from "@/components/ui/overlayStack";
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
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
        className="pointer-events-none absolute left-1/2 top-full z-40 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-row
          border border-line bg-surface-2 px-2 py-1 text-meta leading-4 font-normal text-ink opacity-0 shadow-lg transition-opacity
          group-hover:opacity-100"
      >
        {label}
      </span>
    </div>
  );
}

/**
 * Below `xl` the members list is a genuinely new overlay (Task 7), not just a repositioned
 * panel — G10 binds every new overlay to Escape-to-close (scoped to the topmost one, via the
 * same `overlayStack` Modal/Drawer use), `role="dialog"` + `aria-modal`, and focus containment.
 * At `xl`+ this never mounts; `MembersPanel` renders bare, inline, no dialog semantics, because
 * it isn't acting as an overlay there (trapping focus in an always-visible inline column would
 * break normal keyboard flow into the chat/composer).
 */
function MembersOverlay({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Captured once, at mount — same trick Drawer uses: the trigger (the header's "Show Member
  // List" button) is `document.activeElement` at the moment this mounts, since the user just
  // clicked it, so there's no need for a dedicated ref just to restore focus to it on close.
  const [previouslyFocused] = useState<HTMLElement | null>(() => document.activeElement as HTMLElement | null);

  // Latest onClose, so caller closure identity never re-runs the overlay effect (see Modal.tsx).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const token = pushOverlay();
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? panel).focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (isTopOverlay(token) && claimEscape(e)) onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null
      );
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);

    // Same scroll lock Drawer.tsx uses: without it the chat behind this dialog stays
    // scrollable while it's open, which is a half-built modal even though G10 doesn't name
    // scroll-locking specifically.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      popOverlay(token);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus();
    };
  }, [previouslyFocused]);

  return (
    <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Members" tabIndex={-1} className="h-full">
      {children}
    </div>
  );
}

function ChannelView({ channel }: { channel: Channel }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const anchorId = searchParams.get("msg");
  const { messages, addPending, removePending, anchored, loadOlder, loadingOlder, olderFailed, hasMore } =
    useMessages({ channelId: channel.id, anchorId });
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [replyToName, setReplyToName] = useState("");
  const [showPins, setShowPins] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  // Stable identity (same precedent as DrawerProvider's `closeDrawer`): MembersOverlay's effect
  // depends on this callback, and `useMessages`' realtime subscription re-renders ChannelView on
  // every incoming message — an inline `() => setShowMembers(false)` would get a new identity
  // each time, tearing the overlay's focus trap/overlayStack registration down and back up on
  // every message while it's open.
  const closeMembers = useCallback(() => setShowMembers(false), []);
  const search = useMessageSearch(channel.server_id);
  const pinned = messages.filter((m) => m.pinned);
  const { markRead } = useUnread(channel.server_id);
  const { open: drawerOpen, toggleDrawer } = useDrawer();
  const lastMessageId = messages[messages.length - 1]?.id;
  // Whether the members list is acting as an overlay (below `xl`) vs. an inline column
  // (`xl`+) — tracked in JS, not just CSS, because the overlay-only accessibility behavior
  // (focus trap, Escape, dialog semantics) must not apply to the inline column.
  const [membersOverlayMode, setMembersOverlayMode] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 1280
  );

  // Mark this channel read on open, and again whenever a new message arrives while it's
  // the open channel — `lastMessageId` changes each time useMessages' realtime subscription
  // appends a row.
  useEffect(() => {
    markRead(channel.id);
  }, [channel.id, lastMessageId, markRead]);

  // The lazy initializer above already gets this right for the first render; this effect only
  // needs to track *subsequent* crossings of the `xl` boundary, via the media query's own
  // change event, so — as with DrawerProvider's `isMobile` — it has no reason to call
  // `setMembersOverlayMode` synchronously from the effect body itself.
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 1279px)");
    const onChange = (e: MediaQueryListEvent) => setMembersOverlayMode(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

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
            onLoadOlder={loadOlder}
            loadingOlder={loadingOlder}
            olderFailed={olderFailed}
            hasMore={hasMore}
            startLabel={`This is the start of #${channel.name}`}
          />
          {anchored && (
            <button
              onClick={jumpToPresent}
              className="absolute bottom-20 right-6 z-10 rounded-pill bg-accent text-white text-meta leading-4 px-3 py-1.5 shadow hover:opacity-90"
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
                <MembersOverlay onClose={closeMembers}>
                  <MembersPanel serverId={channel.server_id} />
                </MembersOverlay>
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
