// Free-plan upload limits (migrations 0054–0055): 20 MB per person per Korea day, and a pause for
// everyone once storage is 95% full. The database enforces both; a refusal from Storage is a generic
// error, so the app asks `upload_status()` to pick the words. Nothing here is a security check.

export const QUOTA_REACHED_MESSAGE = "You've uploaded 20 MB today — try again tomorrow.";
export const UPLOADS_PAUSED_MESSAGE = "Uploads are paused because Mallowchat's storage is almost full.";

/** Below this much left today, a failed upload also says how much is left. */
export const CLOSE_TO_QUOTA_BYTES = 5 * 1024 * 1024;

export type UploadStatus = {
  usedBytes: number;
  limitBytes: number;
  remainingBytes: number;
  paused: boolean;
};

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** `upload_status()`'s jsonb `{used_bytes, limit_bytes, remaining_bytes, paused}`, or null if it isn't that. */
export function parseUploadStatus(raw: unknown): UploadStatus | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const used = num(r.used_bytes);
  const limit = num(r.limit_bytes);
  const remaining = num(r.remaining_bytes);
  if (used === null || limit === null || remaining === null) return null;
  return { usedBytes: used, limitBytes: limit, remainingBytes: Math.max(0, remaining), paused: r.paused === true };
}

/**
 * Why an upload can't start right now, or null if it can. An upload that starts with any quota left
 * is allowed to finish even if it goes over (Call 1), so the file's size isn't compared.
 */
export function uploadBlockedMessage(status: UploadStatus | null): string | null {
  if (!status) return null;
  if (status.paused) return UPLOADS_PAUSED_MESSAGE;
  if (status.remainingBytes <= 0) return QUOTA_REACHED_MESSAGE;
  return null;
}

/** True for the two "limit" messages (so a queue can stop instead of repeating them per file). */
export function isUploadLimitMessage(message: string | null | undefined): boolean {
  return message === QUOTA_REACHED_MESSAGE || message === UPLOADS_PAUSED_MESSAGE;
}

/**
 * Words for a failed upload, given `upload_status()` read just after it: the limit message when a
 * limit is the reason, else `fallback` — plus how much is left today when that's under 5 MB.
 */
export function uploadFailedMessage(status: UploadStatus | null, fallback: string): string {
  const blocked = uploadBlockedMessage(status);
  if (blocked) return blocked;
  if (status && status.remainingBytes < CLOSE_TO_QUOTA_BYTES) {
    return `${fallback} (You have ${formatBytes(status.remainingBytes)} of uploads left today.)`;
  }
  return fallback;
}

/** "512 B", "3.4 KB", "20 MB", "1.2 GB" (1 KB = 1024 B; one decimal below 10). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  if (i === 0) return `${Math.round(value)} B`;
  const shown = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  // 1023.6 KB rounds to "1024 KB": say "1 MB" instead.
  if (shown >= 1024 && i < units.length - 1) return `1 ${units[i + 1]}`;
  return `${shown} ${units[i]}`;
}
