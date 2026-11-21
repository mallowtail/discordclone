"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { adminLoadErrorMessage } from "@/lib/admin/admin";
import {
  ERROR_ROWS_LOADED, ERROR_ROWS_SELECT, clearErrorsFailedText, clearedText, errorKindLabel, groupErrors, timesText,
  type ClientErrorRow, type ErrorGroup,
} from "@/lib/admin/errorLog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { CheckCircle } from "@phosphor-icons/react";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function GroupCard({ group }: { group: ErrorGroup }) {
  const who = [...group.users.map((u) => `@${u}`), ...(group.anonymous ? ["someone not signed in"] : [])];
  return (
    <li className="rounded-card border border-line bg-surface p-3 sm:p-4 space-y-2 min-w-0">
      <p className="font-mono text-meta text-ink break-words whitespace-pre-wrap">{group.message}</p>
      <p className="text-meta text-muted">
        <span className="font-medium text-ink">{timesText(group.total)}</span>
        {" · "}last {when(group.lastSeen)}
        {group.firstSeen !== group.lastSeen && ` · first ${when(group.firstSeen)}`}
        {" · "}{errorKindLabel(group.latest.kind)}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-meta">
        <dt className="text-muted">Pages</dt>
        <dd className="text-ink min-w-0 break-words">
          {group.paths.map((p, i) => (
            <span key={p.path}>
              {i > 0 && ", "}
              <span className="font-mono">{p.path || "/"}</span>
              {group.paths.length > 1 && <span className="text-muted"> ×{p.count}</span>}
            </span>
          ))}
        </dd>
        <dt className="text-muted">Browser</dt>
        <dd className="text-ink min-w-0 break-words">{group.browsers.join(", ")}</dd>
        <dt className="text-muted">Who</dt>
        <dd className="text-ink min-w-0 break-words">{who.join(", ")}</dd>
      </dl>
      {group.latest.stack && (
        <details>
          <summary className="text-meta text-muted hover:text-ink">Stack trace</summary>
          <pre className="mt-1 max-h-64 overflow-auto rounded-row bg-surface-2 p-2 font-mono text-micro text-muted whitespace-pre-wrap break-words">
            {group.latest.stack}
          </pre>
        </details>
      )}
    </li>
  );
}

/**
 * /admin → Errors: errors from people's browsers (uncaught errors, unhandled promises, pages that
 * crashed), grouped by message, newest first, with "Clear". The database scrubs and caps them.
 */
export function AdminErrorsTab() {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<ClientErrorRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("client_errors")
      .select(ERROR_ROWS_SELECT)
      .order("last_seen", { ascending: false })
      .limit(ERROR_ROWS_LOADED);
    if (err) return setError(adminLoadErrorMessage(err.message));
    setError(null);
    setRows((data ?? []) as unknown as ClientErrorRow[]);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() only sets state after its await (fetch-on-mount)
    load();
  }, [load]);

  const groups = useMemo(() => (rows ? groupErrors(rows) : []), [rows]);

  async function clear() {
    setConfirming(false);
    setBusy(true);
    setResult(null);
    const { data, error: err } = await supabase.rpc("admin_clear_errors");
    setResult(err ? { ok: false, text: clearErrorsFailedText(err.message) } : { ok: true, text: clearedText(Number(data) || 0) });
    setBusy(false);
    await load();
  }

  if (error) return <p role="alert" className="text-body text-danger">{error}</p>;
  if (!rows) return <p className="text-body text-muted">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-meta text-muted">
          {rows.length === 0
            ? "Errors from people's browsers show up here."
            : `${groups.length} ${groups.length === 1 ? "error" : "different errors"}, newest first.`}
          {rows.length >= ERROR_ROWS_LOADED && ` Showing the latest ${ERROR_ROWS_LOADED.toLocaleString("en-US")} entries.`}
        </p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => load()}
            className="rounded-control px-3 min-h-11 md:min-h-8 text-meta font-medium text-ink hover:bg-surface-2">
            Refresh
          </button>
          <button type="button" onClick={() => setConfirming(true)} disabled={busy || rows.length === 0}
            className="rounded-control bg-surface-2 px-3 min-h-11 md:min-h-8 text-meta font-medium text-danger hover:bg-danger hover:text-white disabled:opacity-50">
            {busy ? "Clearing…" : "Clear"}
          </button>
        </div>
      </div>
      {result && <p role="status" className={`text-meta ${result.ok ? "text-online" : "text-danger"}`}>{result.text}</p>}
      {rows.length === 0 ? (
        <EmptyState icon={<CheckCircle size={32} />} title="No errors" description="Nothing has gone wrong in anyone's browser lately." />
      ) : (
        <ul className="space-y-3">{groups.map((g) => <GroupCard key={g.message} group={g} />)}</ul>
      )}
      <p className="text-micro text-muted">
        Messages are cut short and scrubbed of anything that looks like an email, a token or a link&apos;s query.
        At most 5,000 are kept; the oldest go first.
      </p>
      {confirming && (
        <ConfirmDialog
          title="Clear the error log?"
          message="Every saved error is deleted. New ones will keep coming in."
          confirmLabel="Clear"
          destructive
          onConfirm={clear}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
