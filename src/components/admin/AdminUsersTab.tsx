"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { Avatar } from "@/components/user/profile/Avatar";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { BanDialog, type BanTarget } from "@/components/admin/BanDialog";
import { unbanErrorMessage, userSearchFilter } from "@/lib/admin/admin";

type Person = BanTarget & { avatar_url: string | null; banned_at: string | null; created_at: string };
type BanRecord = { user_id: string; reason: string | null; deleted_messages: boolean; created_at: string };

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

/**
 * /admin → Users: find someone by username or display name, ban or unban them. Real names and
 * avatars are shown here even for banned people (the admin's view only).
 */
export function AdminUsersTab() {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [bannedOnly, setBannedOnly] = useState(false);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [bans, setBans] = useState<Map<string, BanRecord>>(new Map());
  const [loadError, setLoadError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [banning, setBanning] = useState<Person | null>(null);
  const [unbanning, setUnbanning] = useState<Person | null>(null);
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    // Typing settles for a moment before asking.
    const t = window.setTimeout(async () => {
      let q = supabase.from("profiles").select("id, username, display_name, avatar_url, banned_at, created_at")
        .is("deleted_at", null);
      const filter = userSearchFilter(query);
      if (filter) q = q.or(filter);
      if (bannedOnly) q = q.not("banned_at", "is", null);
      const [{ data, error }, { data: banRows }] = await Promise.all([
        q.order("display_name").limit(100),
        supabase.from("site_bans").select("user_id, reason, deleted_messages, created_at"),
      ]);
      if (!active) return;
      if (error) return setLoadError(true);
      setLoadError(false);
      setPeople((data ?? []) as Person[]);
      setBans(new Map(((banRows ?? []) as BanRecord[]).map((b) => [b.user_id, b])));
    }, 250);
    return () => { active = false; window.clearTimeout(t); };
  }, [supabase, query, bannedOnly, refreshKey]);

  const reload = () => setRefreshKey((k) => k + 1);

  async function unban(p: Person) {
    setUnbanning(null);
    setRowError(null);
    const { error } = await supabase.rpc("site_unban", { target: p.id });
    if (error) setRowError({ id: p.id, text: unbanErrorMessage(error.message) });
    reload();
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by username or display name" aria-label="Search people"
          className="min-w-0 flex-1 rounded-control border border-line bg-surface-2 px-3 py-2 text-body text-ink outline-none focus:border-accent" />
        <label className="flex items-center gap-2 text-body text-ink">
          <input type="checkbox" checked={bannedOnly} onChange={(e) => setBannedOnly(e.target.checked)} className="h-4 w-4" />
          Banned only
        </label>
      </div>

      {loadError ? (
        <p role="alert" className="text-body text-danger">Couldn&apos;t load people — try again.</p>
      ) : people === null ? (
        <p className="text-body text-muted">Loading…</p>
      ) : people.length === 0 ? (
        <p className="text-body text-muted">{bannedOnly ? "No one is banned." : "No one matches that."}</p>
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line bg-surface">
          {people.map((p) => {
            const ban = bans.get(p.id);
            const self = p.id === user?.id;
            return (
              <li key={p.id} className="p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Avatar url={p.avatar_url} name={p.display_name} seed={p.id} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium text-ink">{p.display_name}</span>
                      {self && <span className="rounded-pill bg-surface-2 px-2 py-0.5 text-meta text-muted">You</span>}
                      {p.banned_at && <span className="rounded-pill bg-danger/15 px-2 py-0.5 text-meta font-medium text-danger">Banned</span>}
                    </div>
                    <div className="text-meta text-muted">@{p.username} · joined {day(p.created_at)}</div>
                    {p.banned_at && (
                      <div className="mt-1 text-meta text-muted">
                        Banned {day(ban?.created_at ?? p.banned_at)}
                        {ban?.deleted_messages && " · their messages were deleted"}
                        {ban?.reason && <span className="block whitespace-pre-wrap break-words text-ink">{ban.reason}</span>}
                      </div>
                    )}
                  </div>
                  {!self && (p.banned_at ? (
                    <button type="button" onClick={() => setUnbanning(p)}
                      className="rounded-control border border-line px-3 py-1.5 min-h-11 md:min-h-0 text-meta font-medium text-ink hover:bg-surface-2">
                      Unban
                    </button>
                  ) : (
                    <button type="button" onClick={() => setBanning(p)}
                      className="rounded-control border border-danger/50 px-3 py-1.5 min-h-11 md:min-h-0 text-meta font-medium text-danger hover:bg-danger/10">
                      Ban
                    </button>
                  ))}
                </div>
                {rowError?.id === p.id && <p role="alert" className="mt-1 text-meta text-danger">{rowError.text}</p>}
              </li>
            );
          })}
        </ul>
      )}

      {banning && <BanDialog person={banning} onClose={() => setBanning(null)} onBanned={reload} />}
      {unbanning && (
        <ConfirmDialog title={`Unban ${unbanning.display_name}`}
          message={`Let ${unbanning.display_name} use Mallowchat again? They can log in, and everyone sees them as before. Group chats they owned stay with their new owners.`}
          confirmLabel="Unban" onConfirm={() => unban(unbanning)} onClose={() => setUnbanning(null)} />
      )}
    </>
  );
}
