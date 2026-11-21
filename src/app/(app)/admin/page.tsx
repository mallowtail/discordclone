"use client";

import { useState } from "react";
import { useIsSiteAdmin } from "@/hooks/useIsSiteAdmin";
import { useDrawer } from "@/components/providers/DrawerProvider";
import { EmptyState } from "@/components/ui/EmptyState";
import { AdminReportsTab } from "@/components/admin/AdminReportsTab";
import { AdminUsersTab } from "@/components/admin/AdminUsersTab";
import { AdminServersTab } from "@/components/admin/AdminServersTab";
import { AdminUsageTab } from "@/components/admin/AdminUsageTab";
import { AdminErrorsTab } from "@/components/admin/AdminErrorsTab";
import { ADMIN_NOT_FOUND } from "@/lib/admin/admin";
import { badgeLabel } from "@/lib/reports/reports";
import { List, ShieldCheck } from "@phosphor-icons/react";

const TABS = ["Reports", "Users", "Servers", "Usage", "Errors"] as const;
type Tab = (typeof TABS)[number];

/**
 * The site admin's page: reports from everywhere, site-wide bans, deleting servers, free-plan usage, errors from people's browsers. Anyone else
 * gets a plain "Not found" (the database refuses every admin call for them anyway).
 */
export default function AdminPage() {
  const isAdmin = useIsSiteAdmin();
  const { open: drawerOpen, toggleDrawer } = useDrawer();
  const [tab, setTab] = useState<Tab>("Reports");
  const [openCount, setOpenCount] = useState(0);

  if (isAdmin === null) return <div className="p-6 text-muted">Loading…</div>;
  if (!isAdmin) {
    return (
      <div className="flex-1 overflow-y-auto">
        <button onClick={toggleDrawer} aria-label="Open navigation" aria-expanded={drawerOpen}
          className="md:hidden m-2 flex items-center justify-center w-11 h-11 text-muted hover:text-ink">
          <List size={20} weight="bold" aria-hidden="true" />
        </button>
        <EmptyState title={ADMIN_NOT_FOUND} description="There's nothing here." />
      </div>
    );
  }

  const badge = badgeLabel(openCount);
  return (
    <>
      <header className="p-3 border-b border-line flex items-center gap-1 sm:gap-3 min-w-0 overflow-x-auto">
        <button onClick={toggleDrawer} aria-label="Open navigation" aria-expanded={drawerOpen}
          className="md:hidden -ml-1 flex items-center justify-center w-11 h-11 flex-none text-muted hover:text-ink">
          <List size={20} weight="bold" aria-hidden="true" />
        </button>
        <h1 className="sr-only sm:not-sr-only sm:flex items-center gap-2 font-semibold text-ink tracking-tight flex-none sm:border-r sm:border-line sm:pr-4">
          <ShieldCheck size={20} weight="bold" aria-hidden="true" className="text-muted" /> Admin
        </h1>
        <nav className="flex items-center gap-1" aria-label="Admin sections">
          {TABS.map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} aria-pressed={tab === t}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-control px-2 sm:px-2.5 min-h-11 md:min-h-8 text-body font-medium ${
                tab === t ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface-2/60 hover:text-ink"
              }`}>
              {t}
              {t === "Reports" && badge && (
                <span className="rounded-pill bg-danger px-1.5 text-micro font-semibold text-white" aria-label={`${openCount} open`}>{badge}</span>
              )}
            </button>
          ))}
        </nav>
      </header>
      <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4">
        <div className="mx-auto max-w-3xl">
          {/* Reports stays mounted so its open count (the badge) stays live on the other tabs. */}
          <div hidden={tab !== "Reports"}><AdminReportsTab onOpenCount={setOpenCount} /></div>
          {tab === "Users" && <AdminUsersTab />}
          {tab === "Servers" && <AdminServersTab />}
          {tab === "Usage" && <AdminUsageTab />}
          {tab === "Errors" && <AdminErrorsTab />}
        </div>
      </div>
    </>
  );
}
