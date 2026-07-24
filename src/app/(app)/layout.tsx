"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { ServerRail } from "@/components/servers/ServerRail";
import { ServerSidebar } from "@/components/servers/ServerSidebar";
import { DmSidebar } from "@/components/dms/DmSidebar";
import { ProfilePopoverProvider } from "@/components/providers/ProfilePopoverProvider";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const supabase = useMemo(() => createClient(), []);
  // The active server is DERIVED from the open channel's route (URL = source of truth),
  // so refresh/deep-link/leave/create all keep the rail + sidebar in sync. null = DM home.
  const [activeServer, setActiveServer] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    const m = pathname.match(/^\/channels\/([^/]+)$/);
    if (!m || m[1] === "first") {
      // DMs / home, or the transient /channels/first landing (leave as-is until it resolves)
      if (!m) setActiveServer(null);
      return;
    }
    let active = true;
    supabase.from("channels").select("server_id").eq("id", m[1]).single().then(({ data }) => {
      if (active && data) setActiveServer(data.server_id as string);
    });
    return () => {
      active = false;
    };
  }, [pathname, supabase]);

  if (loading || !user) return <div className="p-6 text-muted">Loading…</div>;

  return (
    <ProfilePopoverProvider>
      <div className="flex h-screen">
        <ServerRail
          activeServerId={activeServer}
          onSelectServer={(id) => router.push(`/channels/first?server=${id}`)}
          onSelectHome={() => router.push("/dms")}
        />
        {activeServer === null ? <DmSidebar /> : <ServerSidebar serverId={activeServer} />}
        <main className="flex-1 flex flex-col min-w-0">{children}</main>
      </div>
    </ProfilePopoverProvider>
  );
}
