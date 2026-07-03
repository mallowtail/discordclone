"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { ServerRail } from "@/components/ServerRail";
import { ServerSidebar } from "@/components/ServerSidebar";
import { DmSidebar } from "@/components/DmSidebar";
import { useServers } from "@/hooks/useServers";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const { servers } = useServers();
  const [view, setView] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (!touched && view === null && servers.length > 0) setView(servers[0].id);
  }, [servers, touched, view]);

  if (loading || !user) return <div className="p-6 text-muted">Loading…</div>;

  return (
    <div className="flex h-screen">
      <ServerRail
        activeServerId={view}
        onSelectServer={(id) => { setTouched(true); setView(id); }}
        onSelectHome={() => { setTouched(true); setView(null); }}
      />
      {view === null ? <DmSidebar /> : <ServerSidebar serverId={view} />}
      <main className="flex-1 flex flex-col min-w-0">{children}</main>
    </div>
  );
}
