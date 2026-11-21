"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/Modal";
import { ServerIcon } from "@/components/servers/layout/ServerIcon";
import { AdminDeleteServerButton } from "@/components/admin/AdminDeleteServerButton";
import { removeFromVoice, removeReturnedFiles } from "@/components/admin/adminActions";
import {
  BAN_REASON_MAX, adminLoadErrorMessage, adminTransferErrorMessage, banErrorMessage, banResultMessage, canBanNow,
} from "@/lib/admin/admin";

export type BanTarget = { id: string; display_name: string; username: string };
type OwnedServer = { id: string; name: string; icon_url: string | null; member_count: number };
type Member = { user_id: string; username: string; display_name: string; avatar_url: string | null };

/**
 * Site-wide ban (site admin only): first every server they own is given to a member or deleted
 * (the database refuses to leave a server without an owner), then `site_ban`, then the files of
 * any deleted messages are removed and they're dropped from voice.
 */
export function BanDialog({ person, onClose, onBanned }: {
  person: BanTarget;
  onClose: () => void;
  onBanned: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [servers, setServers] = useState<OwnedServer[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [deleteMessages, setDeleteMessages] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const loadServers = useCallback(async () => {
    const { data, error: err } = await supabase.rpc("admin_user_servers", { target: person.id });
    if (err) return setLoadError(adminLoadErrorMessage(err.message));
    setLoadError(null);
    setServers(((data ?? []) as OwnedServer[]).map((s) => ({ ...s, member_count: Number(s.member_count) })));
  }, [supabase, person.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loadServers() only sets state after its await (fetch-on-mount)
    loadServers();
  }, [loadServers]);

  async function ban() {
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("site_ban", {
      target: person.id, delete_messages: deleteMessages, reason: reason.trim() || null,
    });
    if (err) {
      setBusy(false);
      setError(banErrorMessage(err.message));
      // Someone could have made them an owner meanwhile: show the up-to-date list.
      if (err.message.includes("transfer or delete their servers first")) loadServers();
      return;
    }
    const [filesOk, voiceOk] = await Promise.all([removeReturnedFiles(data), removeFromVoice(person.id)]);
    setBusy(false);
    setDone(banResultMessage(person.display_name, { filesOk, voiceOk }));
    onBanned();
  }

  if (done) {
    return (
      <Modal onClose={onClose} title={`Banned ${person.display_name}`} size="sm">
        <div className="px-5 py-4">
          <p role="status" className="text-body text-ink">{done}</p>
          <div className="mt-5 flex justify-end">
            <button type="button" autoFocus onClick={onClose}
              className="rounded-control bg-accent px-4 py-2 text-body font-medium text-white hover:bg-accent-strong">
              Done
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  const ready = canBanNow(servers, busy);
  return (
    <Modal onClose={busy ? () => {} : onClose} title={`Ban ${person.display_name} from Mallowchat`} size="md">
      <div className="space-y-5 px-5 py-4">
        <p className="text-body text-muted">
          <span className="text-ink">{person.display_name}</span> (@{person.username}) won&apos;t be able to log in, and anything they
          have open stops working. Everyone else sees them as &ldquo;Deleted User&rdquo;. Nothing is erased unless you tick the box
          below, and you can unban them later. Group chats they own pass to another member.
        </p>

        <section aria-labelledby="ban-servers">
          <h3 id="ban-servers" className="text-body font-semibold text-ink">Servers they own</h3>
          {loadError ? (
            <p role="alert" className="mt-1 text-meta text-danger">{loadError}</p>
          ) : servers === null ? (
            <p className="mt-1 text-meta text-muted">Checking their servers…</p>
          ) : servers.length === 0 ? (
            <p className="mt-1 text-meta text-muted">They don&apos;t own any servers.</p>
          ) : (
            <>
              <p className="mt-1 text-meta text-muted">Give each server to someone or delete it before banning — a server can&apos;t be left without an owner.</p>
              <ul className="mt-3 space-y-3">
                {servers.map((s) => <OwnedServerRow key={s.id} server={s} onResolved={loadServers} />)}
              </ul>
            </>
          )}
        </section>

        <label className="block">
          <span className="mb-1 block text-meta font-medium text-muted">Reason (only you see this)</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={BAN_REASON_MAX} rows={2} disabled={busy}
            className="w-full resize-none rounded-control border border-line bg-surface-2 px-3 py-2 text-body text-ink outline-none focus:border-accent" />
        </label>

        <label className="flex items-start gap-3">
          <input type="checkbox" checked={deleteMessages} onChange={(e) => setDeleteMessages(e.target.checked)} disabled={busy}
            className="mt-1 h-4 w-4 flex-none accent-[var(--color-danger)]" />
          <span>
            <span className="block text-body text-ink">Also delete all their messages</span>
            <span className="block text-meta text-muted">
              Every message they wrote — in servers, DMs and groups — and the files attached to them. This can&apos;t be undone.
            </span>
          </span>
        </label>

        {error && <p role="alert" className="text-meta text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="rounded-control px-4 py-2 text-body font-medium text-ink hover:bg-surface-2 disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={ban} disabled={!ready}
            className="rounded-control bg-danger px-4 py-2 text-body font-medium text-white hover:bg-danger/90 disabled:opacity-50">
            {busy ? "Banning…" : "Ban"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** One server the person owns: give it to a member (`admin_transfer_server`) or delete it. */
function OwnedServerRow({ server, onResolved }: { server: OwnedServer; onResolved: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [giving, setGiving] = useState(false);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [chosen, setChosen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openPicker() {
    setGiving(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("admin_server_members", { srv: server.id });
    if (err) return setError(adminLoadErrorMessage(err.message));
    setMembers(((data ?? []) as Member[]).sort((a, b) =>
      a.display_name.localeCompare(b.display_name, undefined, { sensitivity: "base" })));
  }

  async function give() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc("admin_transfer_server", { srv: server.id, new_owner: chosen });
    setBusy(false);
    if (err) return setError(adminTransferErrorMessage(err.message));
    onResolved();
  }

  return (
    <li className="rounded-control border border-line p-3">
      <div className="flex flex-wrap items-center gap-3">
        <ServerIcon iconUrl={server.icon_url} name={server.name} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-ink">{server.name}</div>
          <div className="text-meta text-muted">{server.member_count} {server.member_count === 1 ? "member" : "members"}</div>
        </div>
        {!giving && (
          <button type="button" onClick={openPicker}
            className="rounded-control border border-line px-3 py-1.5 min-h-11 md:min-h-0 text-meta font-medium text-ink hover:bg-surface-2">
            Give to…
          </button>
        )}
        <AdminDeleteServerButton server={server} onDeleted={onResolved} />
      </div>
      {giving && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {members !== null && members.length === 0 ? (
            <p className="text-meta text-muted">No one else is in this server — delete it instead.</p>
          ) : (
            <>
              <select value={chosen} onChange={(e) => { setChosen(e.target.value); setError(null); }} disabled={busy || members === null}
                aria-label={`New owner of ${server.name}`}
                className="min-w-0 flex-1 rounded-control border border-line bg-surface-2 px-3 py-2 text-body text-ink outline-none focus:border-accent disabled:opacity-60">
                <option value="">{members === null ? "Loading members…" : "Choose a member…"}</option>
                {(members ?? []).map((m) => (
                  <option key={m.user_id} value={m.user_id}>{m.display_name} (@{m.username})</option>
                ))}
              </select>
              <button type="button" onClick={give} disabled={!chosen || busy}
                className="rounded-control bg-accent px-3 py-2 text-meta font-medium text-white hover:bg-accent-strong disabled:opacity-50">
                {busy ? "Giving…" : "Give"}
              </button>
            </>
          )}
          <button type="button" onClick={() => { setGiving(false); setChosen(""); setError(null); }} disabled={busy}
            className="rounded-control px-3 py-2 text-meta font-medium text-ink hover:bg-surface-2">
            Cancel
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-meta text-danger">{error}</p>}
    </li>
  );
}
