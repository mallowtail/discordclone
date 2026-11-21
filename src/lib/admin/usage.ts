// /admin → Usage (migrations 0054–0055): the free-plan meters from `admin_usage()`, the clean-up
// runs (`cleanup_runs`), and words for the "Run clean-up now" result. Display only — the database
// and the expire-uploads function decide everything.

import { formatBytes } from "@/lib/media/uploadLimits";

export const STORAGE_BUCKETS = ["attachments", "avatars", "server-icons", "stickers"] as const;

export const BUCKET_LABELS: Record<string, string> = {
  attachments: "Message pictures & files",
  avatars: "Avatars",
  "server-icons": "Server icons",
  stickers: "Stickers",
};

/** Voice minutes and video data live in LiveKit's own dashboard (no free-plan usage API). */
export const LIVEKIT_DASHBOARD_URL = "https://cloud.livekit.io";

/** A finished run older than this means the daily 04:00 job probably isn't reaching the function. */
export const STALE_RUN_MS = 26 * 60 * 60 * 1000;
/** An unfinished run older than this looks stuck (the database treats ≥ 10 minutes the same way). */
export const STUCK_RUN_MS = 10 * 60 * 1000;

export type CleanupRun = {
  id: string;
  started_at: string;
  finished_at: string | null;
  trigger: "cron" | "admin" | string;
  actor_id: string | null;
  steps: string[];
  messages_changed: number;
  messages_deleted: number;
  files_deleted: number;
  bytes_freed: number;
  storage_bytes: number | null;
  database_bytes: number | null;
  error: string | null;
};

export type AdminUsage = {
  storage: {
    totalBytes: number;
    limitBytes: number;
    warnAt: number;
    pauseAt: number;
    paused: boolean;
    buckets: { id: string; bytes: number }[];
  };
  database: { bytes: number; limitBytes: number; warnAt: number };
  dailyUploadLimitBytes: number;
  pendingFiles: number;
  runs: CleanupRun[];
};

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function parseRun(raw: unknown): CleanupRun | null {
  const r = obj(raw);
  if (typeof r.id !== "string" || typeof r.started_at !== "string") return null;
  return {
    id: r.id,
    started_at: r.started_at,
    finished_at: typeof r.finished_at === "string" ? r.finished_at : null,
    trigger: typeof r.trigger === "string" ? r.trigger : "cron",
    actor_id: typeof r.actor_id === "string" ? r.actor_id : null,
    steps: Array.isArray(r.steps) ? r.steps.filter((s): s is string => typeof s === "string") : [],
    messages_changed: num(r.messages_changed),
    messages_deleted: num(r.messages_deleted),
    files_deleted: num(r.files_deleted),
    bytes_freed: num(r.bytes_freed),
    storage_bytes: r.storage_bytes == null ? null : num(r.storage_bytes),
    database_bytes: r.database_bytes == null ? null : num(r.database_bytes),
    error: typeof r.error === "string" && r.error ? r.error : null,
  };
}

/** `admin_usage()`'s jsonb, with numbers made numbers and the four buckets always present, in order. */
export function parseAdminUsage(raw: unknown): AdminUsage {
  const r = obj(raw);
  const storage = obj(r.storage);
  const database = obj(r.database);
  const bucketBytes = obj(storage.buckets);
  const extra = Object.keys(bucketBytes).filter((b) => !(STORAGE_BUCKETS as readonly string[]).includes(b)).sort();
  return {
    storage: {
      totalBytes: num(storage.total_bytes),
      limitBytes: num(storage.limit_bytes, 1024 ** 3),
      warnAt: num(storage.warn_at, 0.8),
      pauseAt: num(storage.pause_at, 0.95),
      paused: storage.paused === true,
      buckets: [...STORAGE_BUCKETS, ...extra].map((id) => ({ id, bytes: num(bucketBytes[id]) })),
    },
    database: {
      bytes: num(database.bytes),
      limitBytes: num(database.limit_bytes, 500 * 1024 ** 2),
      warnAt: num(database.warn_at, 0.8),
    },
    dailyUploadLimitBytes: num(r.daily_upload_limit_bytes, 20 * 1024 ** 2),
    pendingFiles: num(r.pending_files),
    runs: (Array.isArray(r.runs) ? r.runs : []).map(parseRun).filter((x): x is CleanupRun => !!x),
  };
}

/** `used / limit` as a fraction (0 for a missing limit). Not capped — over 1 means over the limit. */
export function usageFraction(used: number, limit: number): number {
  return limit > 0 ? Math.max(0, used / limit) : 0;
}

/** "42%", "0.3%", "<0.1%" (0 stays "0%"). */
export function formatPercent(fraction: number): string {
  const p = fraction * 100;
  if (p <= 0) return "0%";
  if (p < 0.1) return "<0.1%";
  if (p < 10) return `${Math.round(p * 10) / 10}%`;
  return `${Math.round(p)}%`;
}

/** "ok" below the warning line, "warn" from it, "danger" from the pause line (when there is one). */
export function usageLevel(fraction: number, warnAt: number, pauseAt?: number): "ok" | "warn" | "danger" {
  if (pauseAt !== undefined && fraction >= pauseAt) return "danger";
  if (fraction >= warnAt) return "warn";
  return "ok";
}

/** "12 MB of 1 GB (1.2%)". */
export function usageText(used: number, limit: number): string {
  return `${formatBytes(used)} of ${formatBytes(limit)} (${formatPercent(usageFraction(used, limit))})`;
}

/** The newest run that finished (by finish time), or null. */
export function lastFinishedRun(runs: readonly CleanupRun[]): CleanupRun | null {
  let best: CleanupRun | null = null;
  for (const r of runs) {
    if (!r.finished_at) continue;
    if (!best || Date.parse(r.finished_at) > Date.parse(best.finished_at!)) best = r;
  }
  return best;
}

/** What one run did, in a line: "Removed 3 files (1.2 MB) · 3 messages turned into text". */
export function describeRun(run: CleanupRun): string {
  const parts: string[] = [];
  if (run.files_deleted > 0) {
    parts.push(`Removed ${run.files_deleted} file${run.files_deleted === 1 ? "" : "s"} (${formatBytes(run.bytes_freed)})`);
  }
  if (run.messages_changed > 0) {
    parts.push(`${run.messages_changed} message${run.messages_changed === 1 ? "" : "s"} turned into text`);
  }
  if (run.messages_deleted > 0) {
    parts.push(`${run.messages_deleted} old message${run.messages_deleted === 1 ? "" : "s"} deleted (database almost full)`);
  }
  if (run.steps.includes("pressure")) parts.push("storage was over 80%");
  if (parts.length === 0) return run.finished_at ? "Nothing needed cleaning up." : "Still running…";
  return parts.join(" · ");
}

/** Who started a run. */
export function runTriggerLabel(run: CleanupRun): string {
  return run.trigger === "admin" ? "Run now (admin)" : "Daily run";
}

export type CleanupWarning = { level: "warn" | "danger" | "info"; text: string };

/** "12 minutes", "27 hours", "3 days". */
export function durationText(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"}`;
  return `${Math.floor(h / 24)} days`;
}

/**
 * Things the admin should notice about clean-up: none ever ran; a run looks stuck; the last finished
 * run is older than ~26 hours (the daily job isn't arriving); the last finished run had an error.
 */
export function cleanupWarnings(runs: readonly CleanupRun[], now: number): CleanupWarning[] {
  const out: CleanupWarning[] = [];
  const stuck = runs.find((r) => !r.finished_at && now - Date.parse(r.started_at) >= STUCK_RUN_MS);
  if (stuck) {
    out.push({
      level: "danger",
      text: `A clean-up started ${durationText(now - Date.parse(stuck.started_at))} ago and never finished — it may be stuck. The next run will mark it stopped.`,
    });
  }
  const last = lastFinishedRun(runs);
  if (!last) {
    if (!stuck) {
      out.push({ level: "info", text: "No clean-up has run yet. The daily run is at 04:00 Korea time." });
    }
    return out;
  }
  const age = now - Date.parse(last.finished_at!);
  if (age > STALE_RUN_MS) {
    out.push({
      level: "danger",
      text: `The last clean-up finished ${durationText(age)} ago — the daily 04:00 run doesn't seem to be happening.`,
    });
  }
  if (last.error) out.push({ level: "danger", text: `The last clean-up had a problem: ${last.error}` });
  return out;
}

/**
 * Words for the "Run clean-up now" reply from the expire-uploads function (HTTP status + JSON body):
 * 200 ok; 409 already running; 401 not the admin; anything else (500) its error.
 */
export function runNowResultText(status: number | null, body: unknown): { ok: boolean; text: string } {
  const b = obj(body);
  const error = typeof b.error === "string" && b.error ? b.error : null;
  if (status === 200 && b.ok !== false && !error) {
    const files = num(b.files_deleted);
    return {
      ok: true,
      text: files > 0 ? `Clean-up finished — removed ${files} file${files === 1 ? "" : "s"}.` : "Clean-up finished — nothing needed removing.",
    };
  }
  if (status === 409) return { ok: false, text: "A clean-up is already running — try again in a few minutes." };
  if (status === 401 || status === 403) return { ok: false, text: "Only the Mallowchat admin can do that." };
  if (status === null) return { ok: false, text: "Couldn't reach the clean-up function — check your connection and try again." };
  return { ok: false, text: `Clean-up failed${error ? `: ${error}` : ` (HTTP ${status})`}` };
}
