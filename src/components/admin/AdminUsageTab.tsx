"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { adminLoadErrorMessage } from "@/lib/admin/admin";
import { formatBytes } from "@/lib/media/uploadLimits";
import {
  BUCKET_LABELS, LIVEKIT_DASHBOARD_URL, cleanupWarnings, describeRun, durationText, formatPercent,
  lastFinishedRun, parseAdminUsage, runNowResultText, runTriggerLabel, usageFraction, usageLevel, usageText,
  type AdminUsage, type CleanupRun,
} from "@/lib/admin/usage";
import { ArrowSquareOut, Warning, WarningOctagon, Info } from "@phosphor-icons/react";

const FILL: Record<"ok" | "warn" | "danger", string> = {
  ok: "bg-accent",
  warn: "bg-amber",
  danger: "bg-danger",
};

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** A horizontal meter against a limit, with thin marker lines (80% warning, 95% pause). */
function Meter({ label, used, limit, warnAt, pauseAt, lines, size = "md" }: {
  label: string; used: number; limit: number; warnAt: number; pauseAt?: number;
  /** Fractions to draw marker lines at. */
  lines: number[];
  size?: "md" | "sm";
}) {
  const fraction = usageFraction(used, limit);
  const level = usageLevel(fraction, warnAt, pauseAt);
  const width = Math.min(100, fraction * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-meta">
        <span className={size === "md" ? "text-body font-medium text-ink" : "text-ink"}>{label}</span>
        <span className="text-muted tabular-nums">{usageText(used, limit)}</span>
      </div>
      <div
        role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={Math.min(used, limit)}
        aria-valuetext={usageText(used, limit)}
        className={`relative mt-1 w-full overflow-hidden rounded-pill bg-surface-2 ${size === "md" ? "h-3" : "h-2"}`}
      >
        {/* A sliver stays visible for tiny non-zero usage, so "something is there" reads. */}
        <div className={`h-full rounded-pill ${FILL[level]}`} style={{ width: used > 0 ? `max(${width}%, 3px)` : 0 }} />
        {lines.map((l) => (
          <span key={l} aria-hidden="true" className="absolute top-0 bottom-0 w-px bg-ink/60" style={{ left: `${l * 100}%` }} />
        ))}
      </div>
      {size === "md" && (
        <div className="relative mt-0.5 h-4 text-micro text-muted" aria-hidden="true">
          {lines.map((l) => (
            <span key={l} className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${l * 100}%` }}>{formatPercent(l)}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function Notice({ level, children }: { level: "warn" | "danger" | "info"; children: React.ReactNode }) {
  const Icon = level === "info" ? Info : level === "warn" ? Warning : WarningOctagon;
  const tone = level === "info" ? "text-muted" : level === "warn" ? "text-amber" : "text-danger";
  return (
    <p role={level === "info" ? undefined : "alert"} className={`flex items-start gap-2 text-meta ${tone}`}>
      <Icon size={16} weight="bold" aria-hidden="true" className="mt-0.5 flex-none" />
      <span>{children}</span>
    </p>
  );
}

function RunRow({ run }: { run: CleanupRun }) {
  return (
    <li className="py-2 border-b border-line last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-meta">
        <span className="text-ink">{when(run.started_at)}</span>
        <span className="text-muted">
          {runTriggerLabel(run)}
          {run.finished_at ? ` · took ${durationText(Date.parse(run.finished_at) - Date.parse(run.started_at))}` : " · not finished"}
        </span>
      </div>
      <p className="text-meta text-muted">{describeRun(run)}</p>
      {run.error && <p className="text-meta text-danger break-words">Error: {run.error}</p>}
    </li>
  );
}

/**
 * /admin → Usage: storage (total and per bucket) against the free plan's 1 GB with the 80% warning
 * and 95% pause lines, the database against 500 MB, the clean-up runs (with a warning when the
 * daily run seems to have stopped), "Run clean-up now", and a link to LiveKit for voice usage.
 */
export function AdminUsageTab() {
  const supabase = useMemo(() => createClient(), []);
  const [usage, setUsage] = useState<AdminUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  // "Now" for the staleness warning; refreshed with every load so render stays pure.
  const [loadedAt, setLoadedAt] = useState(0);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc("admin_usage");
    if (err) return setError(adminLoadErrorMessage(err.message));
    setError(null);
    setUsage(parseAdminUsage(data));
    setLoadedAt(Date.now());
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() only sets state after its await (fetch-on-mount)
    load();
  }, [load]);

  async function runNow() {
    setRunning(true);
    setResult(null);
    let status: number | null = null;
    let body: unknown = null;
    try {
      // Sends the admin's own login; the function checks is_site_admin() for it.
      const { data, error: err } = await supabase.functions.invoke("expire-uploads", { method: "POST" });
      if (!err) {
        status = 200;
        body = data;
      } else {
        const ctx = (err as { context?: unknown }).context;
        if (ctx instanceof Response) {
          status = ctx.status;
          body = await ctx.json().catch(() => null);
        }
      }
    } catch {
      status = null;
    }
    setResult(runNowResultText(status, body));
    setRunning(false);
    await load();
  }

  if (error) return <p role="alert" className="text-body text-danger">{error}</p>;
  if (!usage) return <p className="text-body text-muted">Loading…</p>;

  const { storage, database } = usage;
  const storageFraction = usageFraction(storage.totalBytes, storage.limitBytes);
  const dbFraction = usageFraction(database.bytes, database.limitBytes);
  const warnings = cleanupWarnings(usage.runs, loadedAt);
  const last = lastFinishedRun(usage.runs);

  return (
    <div className="space-y-6">
      <section aria-labelledby="usage-storage" className="space-y-3">
        <h2 id="usage-storage" className="text-title font-semibold text-ink">File storage</h2>
        <Meter label="All files" used={storage.totalBytes} limit={storage.limitBytes}
          warnAt={storage.warnAt} pauseAt={storage.pauseAt} lines={[storage.warnAt, storage.pauseAt]} />
        {storage.paused ? (
          <Notice level="danger">Uploads are paused for everyone (storage is at {formatPercent(storageFraction)}). Text chat still works.</Notice>
        ) : storageFraction >= storage.warnAt ? (
          <Notice level="warn">Storage is over {formatPercent(storage.warnAt)} — the daily clean-up turns the oldest uploads into text until it&apos;s under 75%. Uploads pause at {formatPercent(storage.pauseAt)}.</Notice>
        ) : null}
        <div className="space-y-2 pl-0 sm:pl-3">
          {storage.buckets.map((b) => (
            <Meter key={b.id} size="sm" label={BUCKET_LABELS[b.id] ?? b.id} used={b.bytes} limit={storage.limitBytes}
              warnAt={storage.warnAt} pauseAt={storage.pauseAt} lines={[storage.warnAt, storage.pauseAt]} />
          ))}
        </div>
        <p className="text-meta text-muted">
          Each person can upload {formatBytes(usage.dailyUploadLimitBytes)} a day (Korea time). Pictures and files older than 30 days become text, except in pinned or kept messages.
          {usage.pendingFiles > 0 && ` ${usage.pendingFiles} file${usage.pendingFiles === 1 ? " is" : "s are"} waiting to be removed.`}
        </p>
      </section>

      <section aria-labelledby="usage-db" className="space-y-3">
        <h2 id="usage-db" className="text-title font-semibold text-ink">Database</h2>
        <Meter label="Messages and everything else" used={database.bytes} limit={database.limitBytes}
          warnAt={database.warnAt} lines={[database.warnAt]} />
        {dbFraction >= database.warnAt && (
          <Notice level="warn">The database is over {formatPercent(database.warnAt)} — the daily clean-up deletes the oldest messages (never pinned or kept ones) until it&apos;s under 75%.</Notice>
        )}
      </section>

      <section aria-labelledby="usage-cleanup" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="usage-cleanup" className="text-title font-semibold text-ink">Clean-up</h2>
          <button type="button" onClick={runNow} disabled={running}
            className="rounded-control bg-accent px-3 min-h-11 md:min-h-8 text-meta font-medium text-white hover:bg-accent-strong disabled:opacity-50">
            {running ? "Running…" : "Run clean-up now"}
          </button>
        </div>
        {result && (
          <p role="status" className={`text-meta ${result.ok ? "text-online" : "text-danger"}`}>{result.text}</p>
        )}
        <p className="text-meta text-muted">
          Runs every day at 04:00 Korea time.{" "}
          {last ? `Last finished ${when(last.finished_at!)} — ${describeRun(last)}` : ""}
        </p>
        {warnings.map((w) => <Notice key={w.text} level={w.level}>{w.text}</Notice>)}
        {usage.runs.length > 0 && (
          <div>
            <h3 className="text-meta font-semibold text-muted uppercase tracking-wide">Recent runs</h3>
            <ul>{usage.runs.map((r) => <RunRow key={r.id} run={r} />)}</ul>
          </div>
        )}
      </section>

      <section aria-labelledby="usage-voice" className="space-y-2">
        <h2 id="usage-voice" className="text-title font-semibold text-ink">Voice and video</h2>
        <p className="text-meta text-muted">
          LiveKit&apos;s free plan includes 5,000 voice minutes and 50 GB of video a month. It has no usage feed for the free plan, so check its dashboard.
        </p>
        <a href={LIVEKIT_DASHBOARD_URL} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-meta font-medium text-accent hover:underline">
          Open the LiveKit dashboard <ArrowSquareOut size={14} aria-hidden="true" />
        </a>
      </section>
    </div>
  );
}
