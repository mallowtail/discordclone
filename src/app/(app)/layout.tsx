"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { ServerRail } from "@/components/servers/ServerRail";
import { ServerSidebar } from "@/components/servers/ServerSidebar";
import { DmSidebar } from "@/components/dms/DmSidebar";
import { ProfilePopoverProvider } from "@/components/providers/ProfilePopoverProvider";
import { PresenceProvider } from "@/components/providers/PresenceProvider";
import { UnreadProvider } from "@/components/providers/UnreadProvider";
import { DrawerProvider, useDrawer } from "@/components/providers/DrawerProvider";
import { Drawer } from "@/components/ui/Drawer";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const supabase = useMemo(() => createClient(), []);
  // The active server is DERIVED from the open channel's route (URL = source of truth),
  // so refresh/deep-link/leave/create all keep the rail + sidebar in sync. null = DM home.
  const [resolvedServer, setResolvedServer] = useState<string | null>(null);
  // Leaving the channel routes (DMs / home) clears the active server. Adjusted during render
  // when the pathname changes (React's "store the previous prop" pattern) instead of in an effect.
  const onChannelRoute = /^\/channels\/[^/]+$/.test(pathname);
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    if (!onChannelRoute) setResolvedServer(null);
  }
  // Off the channel routes it's always null, even if a late channel lookup lands mid-navigation.
  const activeServer = onChannelRoute ? resolvedServer : null;

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    const m = pathname.match(/^\/channels\/([^/]+)$/);
    // DMs / home (cleared during render above), or the transient /channels/first landing
    // (leave as-is until it resolves)
    if (!m || m[1] === "first") return;
    let active = true;
    supabase.from("channels").select("server_id").eq("id", m[1]).single().then(({ data }) => {
      if (active && data) setResolvedServer(data.server_id as string);
    });
    return () => {
      active = false;
    };
  }, [pathname, supabase]);

  if (loading || !user) return <div className="p-6 text-muted">Loading…</div>;

  return (
    <DrawerProvider>
      <PresenceProvider>
        <UnreadProvider>
          <ProfilePopoverProvider>
            <AppShell activeServer={activeServer}>{children}</AppShell>
          </ProfilePopoverProvider>
        </UnreadProvider>
      </PresenceProvider>
    </DrawerProvider>
  );
}

/**
 * The rail/sidebar/main grid, split out from AppLayout so it can sit inside DrawerProvider
 * and call `useDrawer()`. Below `md` the rail + channel sidebar render inside Task 2's Drawer
 * (triggered by a hamburger in the channel/DM header); at `md` and up they're inline.
 */
function AppShell({ activeServer, children }: { activeServer: string | null; children: ReactNode }) {
  const router = useRouter();
  const { open, isMobile, closeDrawer } = useDrawer();

  function selectServer(id: string) {
    router.push(`/channels/first?server=${id}`);
    closeDrawer();
  }
  function selectHome() {
    router.push("/dms");
    closeDrawer();
  }

  const nav = (
    <>
      <ServerRail
        activeServerId={activeServer}
        onSelectServer={selectServer}
        onSelectHome={selectHome}
        suppressFlyouts={isMobile}
      />
      {activeServer === null ? <DmSidebar /> : <ServerSidebar serverId={activeServer} />}
    </>
  );

  return (
    <div className="flex h-screen">
      {isMobile ? (
        <Drawer open={open} onClose={closeDrawer} label="Navigation">
          <div className="flex h-full">{nav}</div>
        </Drawer>
      ) : (
        nav
      )}
      <main className="flex-1 flex flex-col min-w-0">{children}</main>
    </div>
  );
}
