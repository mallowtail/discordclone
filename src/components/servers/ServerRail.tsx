"use client";

import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useServers } from "@/hooks/useServers";
import { ServerIcon } from "@/components/servers/ServerIcon";
import { AddServerDialog } from "@/components/servers/AddServerDialog";

function RailItem({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  function showFlyout() {
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

export function ServerRail({
  activeServerId,
  onSelectServer,
  onSelectHome,
}: {
  activeServerId: string | null;
  onSelectServer: (id: string) => void;
  onSelectHome: () => void;
}) {
  const { servers } = useServers();
  const [adding, setAdding] = useState(false);

  return (
    <div className="w-[72px] bg-surface-2 flex flex-col items-center py-3 gap-2 overflow-y-auto">
      <RailItem
        active={activeServerId === null}
        label="Direct Messages"
        onClick={onSelectHome}
      >
        <div
          className={`w-11 h-11 flex items-center justify-center text-lg rounded-2xl ${
            activeServerId === null ? "bg-accent" : "bg-surface"
          }`}
        >
          💬
        </div>
      </RailItem>
      <div className="w-8 h-px bg-line my-1" />
      {servers.map((s) => (
        <RailItem
          key={s.id}
          active={activeServerId === s.id}
          label={s.name}
          onClick={() => onSelectServer(s.id)}
        >
          <ServerIcon iconUrl={s.icon_url} name={s.name} />
        </RailItem>
      ))}
      <RailItem
        active={false}
        label="Add a server"
        onClick={() => setAdding(true)}
      >
        <div className="w-11 h-11 rounded-2xl bg-surface text-accent text-xl flex items-center justify-center">
          +
        </div>
      </RailItem>
      {adding && <AddServerDialog onClose={() => setAdding(false)} />}
    </div>
  );
}
