// The site admin's tools (/admin, migrations 0052–0053): words for the database's refusals, the
// user search filter, and the files a deletion hands back for the app to remove from Storage.
// The database decides who is admin and what they may do; nothing here is a security check.

import { escapeLike } from "@/lib/users/friends";

/** Longest ban reason (site_bans.reason allows 512; keep it in line with report notes). */
export const BAN_REASON_MAX = 500;

/** What /admin shows anyone who isn't the site admin. */
export const ADMIN_NOT_FOUND = "Not found";

/** The buckets the admin's Storage policies cover (0053); anything else is never sent to remove(). */
const ADMIN_BUCKETS = new Set(["attachments", "server-icons", "stickers"]);

export type StorageFileRow = { bucket: string; path: string };

/**
 * The `(bucket, path)` rows returned by `site_ban(…, true)`, `admin_delete_message` and
 * `admin_delete_server`, grouped by bucket for `storage.from(bucket).remove(paths)` (Supabase
 * blocks deleting Storage rows from SQL). Duplicates, blanks and buckets outside the admin's
 * policies are dropped.
 */
export function filesByBucket(rows: readonly StorageFileRow[] | null | undefined): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of rows ?? []) {
    if (!r?.bucket || !r.path || !ADMIN_BUCKETS.has(r.bucket)) continue;
    const list = out.get(r.bucket) ?? [];
    if (!list.includes(r.path)) list.push(r.path);
    out.set(r.bucket, list);
  }
  return out;
}

/**
 * A PostgREST `or=` filter matching username or display name containing `query` (case-insensitive),
 * or null for an empty search. Only letters, numbers, spaces and `_ . -` are kept (so commas,
 * brackets, quotes and `*` can't change the filter), LIKE wildcards are escaped, and the pattern is
 * double-quoted with PostgREST's own backslash escaping.
 */
export function userSearchFilter(query: string): string | null {
  const clean = query.replace(/^@/, "").replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, 50);
  if (!clean) return null;
  const pattern = `%${escapeLike(clean)}%`;
  const quoted = `"${pattern.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
  return `username.ilike.${quoted},display_name.ilike.${quoted}`;
}

const NOT_PERMITTED = "Only the Mallowchat admin can do that.";

/** User-facing text for a failed `site_ban`. */
export function banErrorMessage(message: string | undefined): string {
  if (message?.includes("transfer or delete their servers first")) return "They still own servers — give each one to someone or delete it first.";
  if (message?.includes("you cannot ban yourself")) return "You can't ban yourself.";
  if (message?.includes("cannot ban a site admin")) return "You can't ban another admin.";
  if (message?.includes("already banned")) return "They're already banned.";
  if (message?.includes("user not found")) return "That account isn't there anymore.";
  if (message?.includes("not permitted")) return NOT_PERMITTED;
  return "Couldn't ban them — try again.";
}

/** User-facing text for a failed `site_unban`. */
export function unbanErrorMessage(message: string | undefined): string {
  if (message?.includes("not banned")) return "They aren't banned anymore.";
  if (message?.includes("not permitted")) return NOT_PERMITTED;
  return "Couldn't unban them — try again.";
}

/** User-facing text for a failed `admin_delete_message`. */
export function adminDeleteMessageErrorMessage(message: string | undefined): string {
  if (message?.includes("message not found")) return "That message is already gone.";
  if (message?.includes("not permitted")) return NOT_PERMITTED;
  return "Couldn't delete the message — try again.";
}

/** User-facing text for a failed `admin_delete_server`. */
export function adminDeleteServerErrorMessage(message: string | undefined): string {
  if (message?.includes("server not found")) return "That server is already gone.";
  if (message?.includes("not permitted")) return NOT_PERMITTED;
  return "Couldn't delete the server — try again.";
}

/** User-facing text for a failed `admin_transfer_server`. */
export function adminTransferErrorMessage(message: string | undefined): string {
  if (message?.includes("they already own this server")) return "They already own this server.";
  if (message?.includes("not a member")) return "That person isn't in this server anymore.";
  if (message?.includes("server not found")) return "That server is already gone.";
  if (message?.includes("not permitted")) return NOT_PERMITTED;
  return "Couldn't give the server away — try again.";
}

/** User-facing text for any other refused admin call (listing servers, members, …). */
export function adminLoadErrorMessage(message: string | undefined): string {
  if (message?.includes("not permitted")) return NOT_PERMITTED;
  return "Couldn't load that — try again.";
}

/** The ban dialog's "Ban" button: only once their server list has loaded and nothing is left in it. */
export function canBanNow(ownedServers: readonly unknown[] | null, busy: boolean): boolean {
  return ownedServers !== null && ownedServers.length === 0 && !busy;
}

/** What the admin sees after a ban, depending on how the clean-up steps went. */
export function banResultMessage(name: string, steps: { filesOk: boolean; voiceOk: boolean }): string {
  const problems: string[] = [];
  if (!steps.filesOk) problems.push("some of their files couldn't be removed");
  if (!steps.voiceOk) problems.push("they couldn't be removed from voice calls");
  if (problems.length === 0) return `${name} is banned.`;
  return `${name} is banned, but ${problems.join(" and ")}.`;
}

/** What the admin sees when a deletion went through but some of its files are still in Storage. */
export function filesLeftMessage(what: "message" | "server" | "ban"): string {
  if (what === "message") return "The message is gone, but its file couldn't be removed — try again.";
  if (what === "server") return "The server is gone, but some of its files couldn't be removed — try again.";
  return "Some of their files couldn't be removed — try again.";
}

/**
 * Did /api/admin/ban-voice fully work? It answers `{ removed, failed }` (200 whenever the route
 * itself ran); any room it couldn't remove them from counts as a partial failure.
 */
export function voiceRemovalOk(status: number, body: unknown): boolean {
  if (status < 200 || status >= 300) return false;
  const failed = (body as { failed?: unknown } | null)?.failed;
  return failed === undefined || failed === 0;
}
