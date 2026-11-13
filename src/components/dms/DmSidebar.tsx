"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NewDmDialog } from "@/components/dms/NewDmDialog";
import { GroupIcon } from "@/components/dms/GroupIcon";
import { useConversations } from "@/hooks/useConversations";
import { Avatar } from "@/components/user/Avatar";
import { UserPanel } from "@/components/user/UserPanel";
import { useProfilePopover } from "@/components/providers/ProfilePopoverProvider";
import { usePresence } from "@/hooks/usePresence";
import { useDrawer } from "@/components/providers/DrawerProvider";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ChatCircleDots, Users } from "@phosphor-icons/react";
import { useFriends } from "@/components/providers/FriendsProvider";
import { RequestBadge } from "@/components/dms/RequestBadge";

/** Placeholder for a single DM row: avatar (sm, matching `Avatar size="sm"`) + one name line. */
function DmRowSkeleton() {
  return (
    <div className="flex items-center gap-2 px-2 py-1 min-h-11 md:min-h-0">
      <Skeleton className="h-6 w-6 flex-none rounded-pill" />
      <Skeleton className="h-3 w-24" />
    </div>
  );
}

export function DmSidebar() {
  const pathname = usePathname();
  const { open } = useProfilePopover();
  const { isOnline } = usePresence();
  const { closeDrawer } = useDrawer();
  const { conversations: dms, loaded } = useConversations();

  // Extract active conversation ID from pathname (e.g., /dms/abc123 -> abc123)
  // pathSegments[2] is the segment after /dms/, which matches a real id or nothing
  const pathSegments = pathname.split("/");
  const activeConversationId = pathSegments[1] === "dms" ? pathSegments[2] : null;

  const { incoming } = useFriends();
  const onFriendsPage = pathname === "/dms";

  return (
    <aside className="w-[clamp(12.5rem,18vw,16.25rem)] bg-sidebar flex flex-col">
      <div className="p-3 font-semibold text-ink tracking-tight border-b border-line">Direct Messages</div>
      <nav className="flex-1 overflow-y-auto p-2 text-muted" aria-busy={!loaded || undefined}>
        <Link href="/dms" onClick={closeDrawer} aria-current={onFriendsPage ? "page" : undefined}
          className={`relative flex items-center gap-2 px-2 py-1.5 min-h-11 md:min-h-0 rounded-row text-body ${
            onFriendsPage ? "bg-surface text-ink font-medium" : "hover:bg-surface/60 text-muted hover:text-ink"
          }`}>
          {onFriendsPage && (
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-4 bg-accent rounded-full" aria-hidden="true" />
          )}
          <Users size={20} weight="bold" aria-hidden="true" className="flex-none" />
          <span className="flex-1">Friends</span>
          <RequestBadge count={incoming.length} />
        </Link>
        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted mt-2 mb-1">
          Direct Messages <NewDmDialog />
        </div>
        {!loaded ? (
          Array.from({ length: 5 }).map((_, i) => <DmRowSkeleton key={i} />)
        ) : dms.length === 0 ? (
          <EmptyState
            icon={<ChatCircleDots size={28} weight="bold" aria-hidden="true" />}
            title="No direct messages yet"
            description="Start one with the + above."
          />
        ) : (
          dms.map((d) => {
            const other = d.isGroup ? null : d.others[0] ?? null;
            const online = !!other && isOnline(other.id);
            const isActive = d.id === activeConversationId;
            const label = d.isGroup
              ? `${d.label} — group, ${d.members.length} members`
              : `${d.label} — ${online ? "Online" : "Offline"}`;
            return (
              <Link key={d.id} href={`/dms/${d.id}`}
                aria-current={isActive ? "page" : undefined}
                aria-label={label}
                onClick={closeDrawer}
                className={`relative flex items-center gap-2 px-2 py-1 min-h-11 md:min-h-0 rounded-row text-body ${
                  isActive
                    ? "bg-surface text-ink font-medium hover:bg-surface"
                    : "hover:bg-surface/60 text-muted hover:text-ink"
                }`}>
                {isActive && (
                  <div
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-4 bg-accent rounded-full"
                    aria-hidden="true"
                  />
                )}
                {d.isGroup ? (
                  <GroupIcon />
                ) : (
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`View ${d.label}'s profile`}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (!other) return; open(other.id, e.currentTarget.getBoundingClientRect()); }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault(); e.stopPropagation();
                      if (!other) return;
                      open(other.id, e.currentTarget.getBoundingClientRect());
                    }}
                    className="flex-none cursor-pointer"
                  >
                    <Avatar
                      url={other?.avatar_url ?? null}
                      name={other?.display_name}
                      seed={other?.id}
                      presence={online ? "online" : "offline"}
                      size="sm"
                    />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{d.label}</span>
                  {d.isGroup && <span className="block text-micro text-muted font-normal">{d.members.length} members</span>}
                </span>
              </Link>
            );
          })
        )}
      </nav>
      <UserPanel />
    </aside>
  );
}
