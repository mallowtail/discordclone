"use client";

import { useState } from "react";
import { useServers } from "@/hooks/useServers";
import { ServerIcon } from "@/components/servers/ServerIcon";
import { AddServerDialog } from "@/components/servers/AddServerDialog";

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
      <button
        onClick={onSelectHome}
        title="Direct Messages"
        className={`w-11 h-11 flex items-center justify-center text-lg ${
          activeServerId === null ? "bg-accent rounded-2xl" : "bg-surface rounded-full hover:rounded-2xl"
        }`}
      >
        💬
      </button>
      <div className="w-8 h-px bg-line my-1" />
      {servers.map((s) => (
        <button
          key={s.id}
          onClick={() => onSelectServer(s.id)}
          title={s.name}
          className={activeServerId === s.id ? "ring-2 ring-accent rounded-2xl" : ""}
        >
          <ServerIcon iconUrl={s.icon_url} name={s.name} />
        </button>
      ))}
      <button
        onClick={() => setAdding(true)}
        title="Add a server"
        className="w-11 h-11 rounded-full bg-surface text-accent text-xl hover:rounded-2xl"
      >
        +
      </button>
      {adding && <AddServerDialog onClose={() => setAdding(false)} />}
    </div>
  );
}
