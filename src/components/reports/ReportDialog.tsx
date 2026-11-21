"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/Modal";
import {
  REPORT_NOTE_MAX, REPORT_REASONS, REPORT_SENT_MESSAGE, reportErrorMessage, reportTitle,
  type ReportKind, type ReportReason,
} from "@/lib/reports/reports";

/**
 * The report form: a reason, an optional note, Send. `create_report` checks everything again
 * (who may report what, the rate limit, one open report per target) and builds the evidence
 * snapshot itself. `inServer` only changes the wording of who will see it.
 */
export function ReportDialog({
  kind,
  targetId,
  inServer = false,
  onClose,
}: {
  kind: ReportKind;
  /** The message, user or server id. */
  targetId: string;
  /** A message in a server channel: that server's moderators see it too. */
  inServer?: boolean;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!reason || busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc("create_report", {
      report_kind: kind,
      target: targetId,
      report_reason: reason,
      report_note: note.trim() || null,
    });
    setBusy(false);
    if (err) return setError(reportErrorMessage(err.message));
    setSent(true);
  }

  const audience = inServer
    ? "This server's moderators and the Mallowchat admin can see your report."
    : "Only the Mallowchat admin can see your report.";

  return (
    <Modal onClose={onClose} title={reportTitle(kind)} size="sm">
      {sent ? (
        <div className="px-5 py-4">
          <p role="status" className="text-body text-ink">{REPORT_SENT_MESSAGE}</p>
          <div className="mt-5 flex justify-end">
            <button type="button" autoFocus onClick={onClose}
              className="rounded-control bg-accent px-4 py-2 text-body font-medium text-white hover:bg-accent-strong">
              Done
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={send} className="px-5 py-4">
          <p className="text-meta text-muted">
            {audience} The person you report isn&apos;t told who sent it.
          </p>
          <fieldset className="mt-4">
            <legend className="mb-1 text-meta font-medium text-muted">What&apos;s wrong?</legend>
            <div className="flex flex-col">
              {REPORT_REASONS.map((r) => (
                <label key={r.id} className="flex min-h-11 md:min-h-9 cursor-pointer items-center gap-3 rounded-row px-2 hover:bg-surface-2">
                  <input type="radio" name="report-reason" value={r.id} checked={reason === r.id}
                    onChange={() => { setReason(r.id); setError(null); }} className="h-4 w-4 accent-accent" />
                  <span className="text-body text-ink">{r.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="mt-3 block">
            <span className="mb-1 block text-meta font-medium text-muted">Anything else they should know? (optional)</span>
            <textarea value={note} onChange={(e) => { setNote(e.target.value); setError(null); }} maxLength={REPORT_NOTE_MAX} rows={3}
              className="w-full resize-none rounded-control border border-line bg-surface-2 px-3 py-2 text-body text-ink outline-none focus:border-accent" />
            <span className="block text-right text-micro text-muted">{note.length}/{REPORT_NOTE_MAX}</span>
          </label>
          {error && <p role="alert" className="mt-1 text-meta text-danger">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-control px-4 py-2 text-body font-medium text-ink hover:bg-surface-2">
              Cancel
            </button>
            <button type="submit" disabled={!reason || busy}
              className="rounded-control bg-danger px-4 py-2 text-body font-medium text-white hover:bg-danger/90 disabled:opacity-50">
              {busy ? "Sending…" : "Send report"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
