"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ServerIcon } from "@/components/servers/layout/ServerIcon";
import { AdminDeleteServerButton } from "@/components/admin/AdminDeleteServerButton";
import { adminLoadErrorMessage } from "@/lib/admin/admin";

export type AdminServer = {
  id: string; name: string; icon_url: string | null; owner_id: string | null; is_public: boolean;
  member_count: number; created_at: string;
};
type Owner = { id: string; display_name: string; username: string };

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

/** /admin → Servers: every server (by name), with Delete server. Owners shown by their real names. */
export function AdminServersTab() {
  const supabase = useMemo(() => createClient(), []);
  const [query, setQuery] = useState("");
  const [servers, setServers] = useState<AdminServer[] | null>(null);
  const [owners, setOwners] = useState<Map<string, Owner>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    const t = window.setTimeout(async () => {
      const { data, error: err } = await supabase.rpc("admin_list_servers", { search: query.trim() || null });
      if (!active) return;
      if (err) return setError(adminLoadErrorMessage(err.message));
      const rows = ((data ?? []) as AdminServer[]).map((s) => ({ ...s, member_count: Number(s.member_count) }));
      const ownerIds = [...new Set(rows.map((s) => s.owner_id).filter((x): x is string => !!x))];
      const { data: people } = ownerIds.length
        ? await supabase.from("profiles").select("id, display_name, username").in("id", ownerIds)
        : { data: [] };
      if (!active) return;
      setError(null);
      setServers(rows);
      setOwners(new Map(((people ?? []) as Owner[]).map((p) => [p.id, p])));
    }, 250);
    return () => { active = false; window.clearTimeout(t); };
  }, [supabase, query, refreshKey]);

  return (
    <>
      <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
        placeholder="Search servers by name" aria-label="Search servers"
        className="mb-4 w-full rounded-control border border-line bg-surface-2 px-3 py-2 text-body text-ink outline-none focus:border-accent" />

      {error ? (
        <p role="alert" className="text-body text-danger">{error}</p>
      ) : servers === null ? (
        <p className="text-body text-muted">Loading…</p>
      ) : servers.length === 0 ? (
        <p className="text-body text-muted">{query.trim() ? "No server matches that." : "There are no servers yet."}</p>
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line bg-surface">
          {servers.map((s) => {
            const owner = s.owner_id ? owners.get(s.owner_id) : undefined;
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-3 p-3">
                <ServerIcon iconUrl={s.icon_url} name={s.name} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-ink">{s.name}</div>
                  <div className="text-meta text-muted">
                    {s.member_count} {s.member_count === 1 ? "member" : "members"} · {s.is_public ? "Public" : "Invite-only"}
                    {" "}· owner {owner ? `${owner.display_name} (@${owner.username})` : "unknown"} · created {day(s.created_at)}
                  </div>
                </div>
                <AdminDeleteServerButton server={s} onDeleted={() => setRefreshKey((k) => k + 1)} />
              </li>
            );
          })}
        </ul>
      )}
      {servers && servers.length === 100 && (
        <p className="mt-2 text-meta text-muted">Showing the first 100 — search to narrow it down.</p>
      )}
    </>
  );
}
