"use client";

import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { ChatCircle, Plus } from "@phosphor-icons/react";
import { useServers } from "@/hooks/useServers";
import { useUnread } from "@/hooks/useUnread";
import { ServerIcon } from "@/components/servers/ServerIcon";
import { AddServerDialog } from "@/components/servers/AddServerDialog";
import type { Server } from "@/types/db";

function RailItem({
  active,
  label,
  onClick,
  children,
  suppressFlyouts = false,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  suppressFlyouts?: boolean;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  function showFlyout() {
    // The rail is fluid-width (Task 7), so the flyout's offset is always read live from the
    // button's own rect rather than assumed — and suppressed entirely while the rail sits
    // inside the mobile Drawer, where there's no mouse to hover with and the flyout would
    // otherwise float over the drawer's own overlay.
    if (suppressFlyouts) return;
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.top + r.height / 2, left: r.right + 12 });
  }
  function hideFlyout() {
    setPos(null);
  }

  return (
    <div
      className="group relative flex items-center justify-center w-full"
      onMouseEnter={showFlyout}
      onMouseLeave={hideFlyout}
    >
      <span
        className={`absolute left-0 w-1 rounded-r-full bg-ink transition-all duration-200 ${
          active ? "h-10" : "h-0 group-hover:h-2.5"
        }`}
      />
      <button ref={btnRef} onClick={onClick} aria-label={label}>
        {children}
      </button>
      {pos &&
        createPortal(
          <span
            style={{ position: "fixed", top: pos.top, left: pos.left, transform: "translateY(-50%)" }}
            className="pointer-events-none z-50 whitespace-nowrap rounded-lg bg-app px-2 py-1 text-sm text-ink shadow-lg"
          >
            {label}
          </span>,
          document.body
        )}
    </div>
  );
}

/** A server's rail button, with an unread badge when any of its channels are unread.
 *  The badge sits on the icon's edge, opposite RailItem's left-edge active indicator,
 *  so the two never overlap. It uses `bg-ink` — the same neutral tone as the active-pill
 *  indicator — rather than `bg-danger`: plain unread is a routine "there's new activity"
 *  state, not an error/destructive one, and `danger` shouldn't be spent here when the
 *  system already has purpose-built `mention`/`mention-ink` tokens reserved for a future,
 *  genuinely urgent @mention badge. */
function ServerRailButton({
  server,
  active,
  onClick,
  suppressFlyouts,
}: {
  server: Server;
  active: boolean;
  onClick: () => void;
  suppressFlyouts?: boolean;
}) {
  const { hasAnyUnread } = useUnread(server.id);
  return (
    <RailItem active={active} label={server.name} onClick={onClick} suppressFlyouts={suppressFlyouts}>
      <span className="relative inline-flex">
        <ServerIcon iconUrl={server.icon_url} name={server.name} />
        {hasAnyUnread && (
          <span
            className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-pill bg-ink ring-2 ring-surface-2"
            aria-hidden="true"
          />
        )}
      </span>
    </RailItem>
  );
}

export function ServerRail({
  activeServerId,
  onSelectServer,
  onSelectHome,
  suppressFlyouts = false,
}: {
  activeServerId: string | null;
  onSelectServer: (id: string) => void;
  onSelectHome: () => void;
  /** Suppress the getBoundingClientRect()-positioned hover flyouts — set while the rail is
   *  rendered inside the mobile Drawer (Task 7), where there's no hover to drive them. */
  suppressFlyouts?: boolean;
}) {
  const { servers } = useServers();
  const [adding, setAdding] = useState(false);

  return (
    <div className="w-[clamp(3.5rem,5vw,4.5rem)] bg-surface-2 flex flex-col items-center py-3 gap-2 overflow-y-auto">
      <RailItem
        active={activeServerId === null}
        label="Direct Messages"
        onClick={onSelectHome}
        suppressFlyouts={suppressFlyouts}
      >
        <div
          className={`w-11 h-11 flex items-center justify-center text-lg rounded-2xl ${
            activeServerId === null ? "bg-accent" : "bg-surface"
          }`}
        >
          <ChatCircle size={22} weight="regular" />
        </div>
      </RailItem>
      <div className="w-8 h-px bg-line my-1" />
      {servers.map((s) => (
        <ServerRailButton
          key={s.id}
          server={s}
          active={activeServerId === s.id}
          onClick={() => onSelectServer(s.id)}
          suppressFlyouts={suppressFlyouts}
        />
      ))}
      <RailItem
        active={false}
        label="Add a server"
        onClick={() => setAdding(true)}
        suppressFlyouts={suppressFlyouts}
      >
        <div className="w-11 h-11 rounded-2xl bg-surface text-accent text-xl flex items-center justify-center">
          <Plus size={18} weight="bold" />
        </div>
      </RailItem>
      {adding && <AddServerDialog onClose={() => setAdding(false)} />}
    </div>
  );
}
