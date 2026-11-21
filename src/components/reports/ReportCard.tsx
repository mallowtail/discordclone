"use client";

import { useMemo, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/user/profile/Avatar";
import { ServerIcon } from "@/components/servers/layout/ServerIcon";
import { MessageContent } from "@/components/messages/list/MessageContent";
import { ForwardedBlock } from "@/components/messages/forwarding/ForwardedBlock";
import { DELETED_USER_NAME, isDeletedProfile } from "@/lib/users/account";
import {
  REPORT_NOTE_MAX, handleReportErrorMessage, personName, reasonLabel, snapshotAsMessage, snapshotAuthor, snapshotPlace,
  type MessageSnapshot, type ReportPerson, type ReportRow, type ServerSnapshot, type UserSnapshot,
} from "@/lib/reports/reports";
import { ChartBar, CheckCircle } from "@phosphor-icons/react";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * One report: reason, note, who sent it and when, the evidence (drawn like a message), how it was
 * handled, and whatever `actions` the viewer may take. `revealIdentity` (site admin only) shows
 * banned people's real names instead of "Deleted User".
 */
export function ReportCard({ report, actions, revealIdentity = false }: {
  report: ReportRow;
  actions?: ReactNode;
  revealIdentity?: boolean;
}) {
  const who = (p: ReportPerson | null) => (revealIdentity && p ? p.display_name : personName(p));
  const handled = report.status === "handled";
  return (
    <article className={`rounded-card border border-line p-4 ${handled ? "bg-surface/40" : "bg-surface"}`}
      aria-label={`Report: ${reasonLabel(report.reason)}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="rounded-pill bg-danger/15 px-2 py-0.5 text-meta font-medium text-danger">{reasonLabel(report.reason)}</span>
        {handled && (
          <span className="inline-flex items-center gap-1 rounded-pill bg-online/15 px-2 py-0.5 text-meta font-medium text-online">
            <CheckCircle size={13} weight="fill" aria-hidden="true" /> Handled
          </span>
        )}
        <span className="text-meta text-muted">
          Reported by <span className="text-ink">{who(report.reporter)}</span> · {when(report.created_at)}
        </span>
      </div>
      {report.note && (
        <p className="mt-2 whitespace-pre-wrap break-words border-l-2 border-line pl-3 text-body text-ink">{report.note}</p>
      )}

      <div className="mt-3 rounded-control border border-line bg-app/40 p-3">
        {report.kind === "message" ? (
          <MessageEvidence snap={report.snapshot as MessageSnapshot} live={revealIdentity ? null : report.target} />
        ) : report.kind === "user" ? (
          <UserEvidence snap={report.snapshot as UserSnapshot} live={revealIdentity ? null : report.target} />
        ) : (
          <ServerEvidence snap={report.snapshot as ServerSnapshot} />
        )}
      </div>

      {handled && (
        <p className="mt-3 text-meta text-muted">
          Handled by <span className="text-ink">{who(report.handler)}</span>
          {report.handled_at && <> · {when(report.handled_at)}</>}
          {report.handled_note && <span className="mt-0.5 block whitespace-pre-wrap break-words text-ink">{report.handled_note}</span>}
        </p>
      )}
      {actions && <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div>}
    </article>
  );
}

function MessageEvidence({ snap, live }: { snap: MessageSnapshot; live: ReportPerson | null }) {
  const author = snapshotAuthor(snap, live);
  const msg = useMemo(() => snapshotAsMessage(snap), [snap]);
  return (
    <div className="flex gap-3">
      <Avatar url={author.avatarUrl} name={author.name} seed={snap.author_id} size="md" deleted={author.deleted} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-semibold text-ink">{author.name}</span>
          {author.username && <span className="text-meta text-muted">@{author.username}</span>}
          <span className="text-meta text-muted">{when(snap.created_at)} · {snapshotPlace(snap)}</span>
        </div>
        <MessageContent msg={msg} />
        {snap.poll_options && snap.poll_options.length > 0 && (
          <ul className="mt-1 max-w-sm space-y-1" aria-label="Poll answers">
            {snap.poll_options.map((o, i) => (
              <li key={i} className="flex items-center gap-2 rounded-row border border-line px-2 py-1 text-body text-ink">
                <ChartBar size={14} className="flex-none text-muted" aria-hidden="true" /> {o}
              </li>
            ))}
          </ul>
        )}
        {snap.forward_snapshot && <ForwardedBlock snapshot={snap.forward_snapshot} />}
      </div>
    </div>
  );
}

function UserEvidence({ snap, live }: { snap: UserSnapshot; live: ReportPerson | null }) {
  const gone = !!live && isDeletedProfile(live);
  return (
    <div className="flex items-start gap-3">
      <Avatar url={gone ? null : snap.avatar_url} name={gone ? DELETED_USER_NAME : snap.display_name} seed={snap.user_id} size="md" deleted={gone} />
      <div className="min-w-0">
        <div className="font-semibold text-ink">{gone ? DELETED_USER_NAME : snap.display_name}</div>
        {!gone && <div className="text-meta text-muted">@{snap.username}</div>}
        {!gone && snap.status && <div className="mt-1 text-meta text-ink">Status: {snap.status}</div>}
        {!gone && snap.bio && <p className="mt-1 whitespace-pre-wrap break-words text-body text-ink">{snap.bio}</p>}
      </div>
    </div>
  );
}

function ServerEvidence({ snap }: { snap: ServerSnapshot }) {
  return (
    <div className="flex items-start gap-3">
      <ServerIcon iconUrl={snap.icon_url} name={snap.name} />
      <div className="min-w-0">
        <div className="font-semibold text-ink">{snap.name}</div>
        <div className="text-meta text-muted">{snap.is_public ? "Public server" : "Invite-only server"}</div>
        {snap.description && <p className="mt-1 whitespace-pre-wrap break-words text-body text-ink">{snap.description}</p>}
      </div>
    </div>
  );
}

/** "Mark handled" with an optional note (`handle_report`); shown on open reports. */
export function MarkHandledButton({ reportId, onDone }: { reportId: string; onDone: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc("handle_report", { report_id: reportId, note: note.trim() || null });
    setBusy(false);
    if (err) return setError(handleReportErrorMessage(err.message));
    setOpen(false);
    setNote("");
    onDone();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="rounded-control bg-accent px-3 py-1.5 min-h-11 md:min-h-0 text-meta font-medium text-white hover:bg-accent-strong">
        Mark handled
      </button>
    );
  }
  return (
    <div className="w-full">
      <label className="block">
        <span className="mb-1 block text-meta font-medium text-muted">What did you do? (optional)</span>
        <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} maxLength={REPORT_NOTE_MAX} rows={2}
          className="w-full resize-none rounded-control border border-line bg-surface-2 px-3 py-2 text-body text-ink outline-none focus:border-accent" />
      </label>
      {error && <p role="alert" className="mt-1 text-meta text-danger">{error}</p>}
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={save} disabled={busy}
          className="rounded-control bg-accent px-3 py-1.5 min-h-11 md:min-h-0 text-meta font-medium text-white hover:bg-accent-strong disabled:opacity-50">
          {busy ? "Saving…" : "Mark handled"}
        </button>
        <button type="button" onClick={() => { setOpen(false); setError(null); }} disabled={busy}
          className="rounded-control px-3 py-1.5 min-h-11 md:min-h-0 text-meta font-medium text-ink hover:bg-surface-2">
          Cancel
        </button>
      </div>
    </div>
  );
}
