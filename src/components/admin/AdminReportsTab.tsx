"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { ReportCard, MarkHandledButton } from "@/components/reports/ReportCard";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { BanDialog, type BanTarget } from "@/components/admin/BanDialog";
import { AdminDeleteServerButton } from "@/components/admin/AdminDeleteServerButton";
import { adminDeleteMessage } from "@/components/admin/adminActions";
import { FilesLeftNotice } from "@/components/admin/FilesLeftNotice";
import { REPORT_SELECT, jumpLink, openReportCount, reportedServer, sortReports, type ReportRow } from "@/lib/reports/reports";
import { adminLoadErrorMessage, type StorageFileRow } from "@/lib/admin/admin";
import { chunkIds } from "@/lib/messages/reactions";

const btn = "rounded-control border border-line px-3 py-1.5 min-h-11 md:min-h-0 text-meta font-medium text-ink hover:bg-surface-2";
const dangerBtn = "rounded-control border border-danger/50 px-3 py-1.5 min-h-11 md:min-h-0 text-meta font-medium text-danger hover:bg-danger/10";

/**
 * /admin → Reports: every report (servers, DMs, groups, users, servers), real identities shown.
 * Actions: jump to the message (when it's a channel message the admin can open), delete it and its
 * files, ban the reported person, delete a reported server, mark handled.
 */
export function AdminReportsTab({ onOpenCount }: { onOpenCount: (n: number) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { user } = useAuth();
  const [reports, setReports] = useState<ReportRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [view, setView] = useState<"open" | "handled">("open");
  // Channel messages the admin can still read: id → channel (for "Jump to message").
  const [readable, setReadable] = useState<Map<string, string | null>>(new Map());
  // Messages the database said are gone (DM messages the admin isn't in can't be checked up front).
  const [gone, setGone] = useState<Set<string>>(new Set());
  // Reported servers' current names (servers the admin can read; others keep their reported name).
  const [serverNames, setServerNames] = useState<Map<string, string>>(new Map());
  const [deleting, setDeleting] = useState<ReportRow | null>(null);
  const [banning, setBanning] = useState<BanTarget | null>(null);
  const [actionError, setActionError] = useState<{ id: string; text: string } | null>(null);
  // Report id → files its message or server deletion left in Storage (retry from the card).
  const [filesLeft, setFilesLeft] = useState<Map<string, { what: "message" | "server"; files: StorageFileRow[] }>>(new Map());
  const seq = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current;
    const { data, error } = await supabase.from("reports").select(REPORT_SELECT).order("created_at", { ascending: false }).limit(500);
    if (my !== seq.current) return;
    if (error) return setLoadError(true);
    const rows = sortReports((data as unknown as ReportRow[] | null) ?? []);
    const msgIds = [...new Set(rows.map((r) => r.message_id).filter((x): x is string => !!x))];
    // A deleted server sets its reports' server_id to null, so these are the ones still there.
    const srvIds = [...new Set(rows.filter((r) => r.kind === "server").map((r) => r.server_id).filter((x): x is string => !!x))];
    // ≤100 ids per request: `.in()` goes into the URL.
    const [msgPages, srvPages] = await Promise.all([
      Promise.all(chunkIds(msgIds).map((ids) => supabase.from("messages").select("id, channel_id").in("id", ids))),
      Promise.all(chunkIds(srvIds).map((ids) => supabase.from("servers").select("id, name").in("id", ids))),
    ]);
    if (my !== seq.current) return;
    setLoadError(false);
    setReports(rows);
    setReadable(new Map(msgPages.flatMap((p) => (p.data ?? []) as { id: string; channel_id: string | null }[]).map((m) => [m.id, m.channel_id])));
    setServerNames(new Map(srvPages.flatMap((p) => (p.data ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name])));
  }, [supabase]);

  const instanceId = useId();
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() only sets state after its await (fetch-on-mount)
    load();
    const channel = supabase
      .channel(`admin-reports:${instanceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "reports" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase, load, instanceId]);

  const openCount = reports ? openReportCount(reports) : 0;
  useEffect(() => { onOpenCount(openCount); }, [openCount, onOpenCount]);

  async function deleteMessage(r: ReportRow) {
    setDeleting(null);
    setActionError(null);
    if (!r.message_id) return;
    const result = await adminDeleteMessage(supabase, r.message_id);
    if (result.error !== null) setActionError({ id: r.id, text: result.error });
    else keepFilesLeft(r.id, "message", result.filesLeft);
    // Deleted now, or already gone: either way there's nothing left to delete.
    if (result.error === null || result.error === "That message is already gone.") setGone((g) => new Set(g).add(r.message_id!));
    load();
  }

  function keepFilesLeft(reportId: string, what: "message" | "server", files: StorageFileRow[]) {
    setFilesLeft((prev) => {
      const next = new Map(prev);
      if (files.length) next.set(reportId, { what, files });
      else next.delete(reportId);
      return next;
    });
  }

  const shown = (reports ?? []).filter((r) => r.status === view);

  return (
    <>
      <div className="mb-4 flex gap-1" role="tablist" aria-label="Which reports">
        {(["open", "handled"] as const).map((v) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
            className={`rounded-control px-3 py-1.5 min-h-11 md:min-h-0 text-body ${view === v ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"}`}>
            {v === "open" ? `Open${reports ? ` (${openCount})` : ""}` : "Handled"}
          </button>
        ))}
      </div>

      {loadError && !reports ? (
        <p role="alert" className="text-body text-danger">Couldn&apos;t load reports — try again.</p>
      ) : reports === null ? (
        <p className="text-body text-muted">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-body text-muted">{view === "open" ? "No open reports. Nice and quiet." : "No handled reports yet."}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {shown.map((r) => {
            const msgId = r.message_id;
            const channelId = msgId ? readable.get(msgId) : undefined;
            const href = channelId !== undefined ? jumpLink(channelId ?? null, msgId) : null;
            const target = r.target;
            const canBan = !!target && target.id !== user?.id && !target.banned_at && !target.deleted_at;
            const liveServer = reportedServer(r, serverNames);
            const left = filesLeft.get(r.id);
            return (
              <div key={r.id}>
                <ReportCard report={r} revealIdentity actions={
                  <>
                    {href && <button type="button" onClick={() => router.push(href)} className={btn}>Jump to message</button>}
                    {r.kind === "message" && msgId && (gone.has(msgId)
                      ? <span className="text-meta text-muted">The message has been deleted.</span>
                      : <button type="button" onClick={() => setDeleting(r)} className={dangerBtn}>Delete message</button>)}
                    {liveServer && (
                      <AdminDeleteServerButton server={liveServer} onDeleted={(files) => { keepFilesLeft(r.id, "server", files); load(); }} />
                    )}
                    {r.kind === "server" && !liveServer && <span className="text-meta text-muted">The server has been deleted.</span>}
                    {canBan && (
                      <button type="button" onClick={() => setBanning({ id: target.id, display_name: target.display_name, username: target.username })}
                        className={dangerBtn}>
                        Ban {target.display_name}
                      </button>
                    )}
                    {target?.banned_at && <span className="text-meta text-muted">{target.display_name} is banned.</span>}
                    {r.status === "open" && <MarkHandledButton reportId={r.id} onDone={load} />}
                  </>
                } />
                {actionError?.id === r.id && <p role="alert" className="mt-1 text-meta text-danger">{actionError.text}</p>}
                {left && (
                  <div className="mt-1">
                    <FilesLeftNotice files={left.files} what={left.what} onChange={(files) => keepFilesLeft(r.id, left.what, files)} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {loadError && reports && <p role="alert" className="mt-2 text-meta text-danger">{adminLoadErrorMessage(undefined)}</p>}

      {deleting && (
        <ConfirmDialog title="Delete message"
          message={`Delete this message by ${deleting.target?.display_name ?? "them"} for everyone, with its attached files? The report keeps its copy of the text (its pictures may stop loading).`}
          confirmLabel="Delete" destructive onConfirm={() => deleteMessage(deleting)} onClose={() => setDeleting(null)} />
      )}
      {banning && <BanDialog person={banning} onClose={() => setBanning(null)} onBanned={load} />}
    </>
  );
}
