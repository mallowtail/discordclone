// Reports (migration 0052): what people can report, the words for it, and turning a stored report
// back into something to show. The database builds the snapshot and decides who may see a report.

import type { ForwardSnapshot, Message } from "@/types/db";
import type { MessageSticker } from "@/lib/messages/stickers";
import { BANNED_ACCOUNT_MESSAGE, DELETED_USER_NAME, isBannedAccountError, isDeletedProfile } from "@/lib/users/account";

export type ReportKind = "message" | "user" | "server";
export type ReportReason = "spam" | "harassment" | "inappropriate" | "hate_speech" | "other";
export type ReportStatus = "open" | "handled";

/** The five reasons, in the order the form lists them. */
export const REPORT_REASONS: readonly { id: ReportReason; label: string }[] = [
  { id: "spam", label: "Spam" },
  { id: "harassment", label: "Harassment or bullying" },
  { id: "inappropriate", label: "Inappropriate content" },
  { id: "hate_speech", label: "Hate speech" },
  { id: "other", label: "Something else" },
];

/** Longest note (on a report, and on marking one handled). */
export const REPORT_NOTE_MAX = 500;

/** Shown after a report is sent. */
export const REPORT_SENT_MESSAGE = "Thanks — the moderators will take a look.";

export function reasonLabel(reason: string): string {
  return REPORT_REASONS.find((r) => r.id === reason)?.label ?? "Something else";
}

/** What the report dialog's title says. */
export function reportTitle(kind: ReportKind): string {
  return kind === "message" ? "Report message" : kind === "user" ? "Report user" : "Report server";
}

/** User-facing text for a failed `create_report`. */
export function reportErrorMessage(message: string | undefined): string {
  if (message?.includes("too many reports")) return "You've sent a lot of reports — try again in a few minutes";
  if (message?.includes("already reported")) return "You already reported this";
  if (message?.includes("note too long")) return `Keep the note under ${REPORT_NOTE_MAX} characters.`;
  if (message?.includes("cannot report yourself")) return "You can't report yourself.";
  if (message?.includes("cannot report your own server")) return "You can't report your own server.";
  if (message?.includes("message not found")) return "That message isn't there anymore.";
  if (message?.includes("user not found")) return "That account isn't there anymore.";
  if (message?.includes("server not found")) return "That server isn't there anymore.";
  if (isBannedAccountError(message)) return BANNED_ACCOUNT_MESSAGE;
  return "Couldn't send the report — try again.";
}

/** User-facing text for a failed `handle_report`. */
export function handleReportErrorMessage(message: string | undefined): string {
  if (message?.includes("already handled")) return "Someone already marked this handled.";
  if (message?.includes("report not found")) return "This report isn't available to you anymore.";
  if (message?.includes("note too long")) return `Keep the note under ${REPORT_NOTE_MAX} characters.`;
  if (isBannedAccountError(message)) return BANNED_ACCOUNT_MESSAGE;
  return "Couldn't mark it handled — try again.";
}

/** User-facing text for a failed `delete_message_as_mod`. */
export function modDeleteErrorMessage(message: string | undefined): string {
  if (message?.includes("message not found")) return "That message is already gone.";
  if (message?.includes("not permitted")) return "You don't have permission to delete that message.";
  if (isBannedAccountError(message)) return BANNED_ACCOUNT_MESSAGE;
  return "Couldn't delete — try again";
}

/** A message report's snapshot, as `create_report` stores it. */
export type MessageSnapshot = {
  message_id: string;
  author_id: string;
  author_username: string | null;
  author_display_name: string | null;
  author_avatar_url: string | null;
  content: string | null;
  image_url: string | null;
  file_url: string | null;
  file_name: string | null;
  gif: Message["gif"];
  sticker: MessageSticker | null;
  forward_snapshot: ForwardSnapshot | null;
  /** The answers, when the message was a poll (its content is then the question). */
  poll_options: string[] | null;
  created_at: string;
  edited_at: string | null;
  channel_id: string | null;
  channel_name: string | null;
  server_id: string | null;
  server_name: string | null;
  conversation_id: string | null;
  is_group: boolean | null;
  group_name: string | null;
};

export type UserSnapshot = {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  status: string | null;
};

export type ServerSnapshot = {
  server_id: string;
  name: string;
  icon_url: string | null;
  description: string | null;
  owner_id: string | null;
  is_public: boolean;
};

/** A profile as embedded in a report row (reporter / reported person / who handled it). */
export type ReportPerson = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  deleted_at?: string | null;
  banned_at?: string | null;
};

export type ReportRow = {
  id: string;
  reporter_id: string;
  kind: ReportKind;
  message_id: string | null;
  target_user_id: string | null;
  server_id: string | null;
  conversation_id: string | null;
  snapshot: MessageSnapshot | UserSnapshot | ServerSnapshot;
  reason: ReportReason;
  note: string | null;
  admin_only: boolean;
  status: ReportStatus;
  handled_by: string | null;
  handled_note: string | null;
  handled_at: string | null;
  created_at: string;
  reporter: ReportPerson | null;
  target: ReportPerson | null;
  handler: ReportPerson | null;
};

/** The PostgREST select for report rows, with the three people embedded (each FK needs a hint). */
export const REPORT_SELECT =
  "*, reporter:profiles!reports_reporter_id_fkey(id, username, display_name, avatar_url, deleted_at, banned_at), " +
  "target:profiles!reports_target_user_id_fkey(id, username, display_name, avatar_url, deleted_at, banned_at), " +
  "handler:profiles!reports_handled_by_fkey(id, username, display_name, avatar_url, deleted_at, banned_at)";

/** Open reports first (newest first), then handled ones (most recently handled first). */
export function sortReports<T extends Pick<ReportRow, "status" | "created_at" | "handled_at">>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    const ka = a.status === "open" ? a.created_at : a.handled_at ?? a.created_at;
    const kb = b.status === "open" ? b.created_at : b.handled_at ?? b.created_at;
    return kb.localeCompare(ka);
  });
}

export function openReportCount(rows: Pick<ReportRow, "status">[]): number {
  return rows.filter((r) => r.status === "open").length;
}

/** The badge text for an open count (nothing at 0; "99+" past 99). */
export function badgeLabel(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}

/** How the reported message's author is shown on a report card.
 *  The snapshot keeps their name at the time; if the account is now deleted or banned, the live
 *  profile wins, so moderators see "Deleted User" like everyone else does. Otherwise the live name
 *  (so they can be found in the member list), falling back to the snapshot. */
export function snapshotAuthor(
  snap: Pick<MessageSnapshot, "author_display_name" | "author_username" | "author_avatar_url">,
  live: ReportPerson | null | undefined,
): { name: string; username: string | null; avatarUrl: string | null; deleted: boolean } {
  if (live && isDeletedProfile(live)) return { name: DELETED_USER_NAME, username: null, avatarUrl: null, deleted: true };
  if (live) return { name: live.display_name, username: live.username, avatarUrl: live.avatar_url, deleted: false };
  return {
    name: snap.author_display_name ?? "Unknown user",
    username: snap.author_username,
    avatarUrl: snap.author_avatar_url,
    deleted: false,
  };
}

/** A report person (reporter, handler) for display: deleted/banned accounts become "Deleted User". */
export function personName(p: ReportPerson | null | undefined): string {
  if (!p || isDeletedProfile(p)) return DELETED_USER_NAME;
  return p.display_name;
}

/** Where the reported message was: "#general in Mallow Club", "a group chat (Name)", "a DM". */
export function snapshotPlace(snap: Pick<MessageSnapshot, "channel_name" | "server_name" | "conversation_id" | "is_group" | "group_name">): string {
  if (snap.channel_name) return snap.server_name ? `#${snap.channel_name} in ${snap.server_name}` : `#${snap.channel_name}`;
  if (snap.is_group) return snap.group_name ? `the group “${snap.group_name}”` : "a group chat";
  if (snap.conversation_id) return "a DM";
  return "an unknown place";
}

/** The snapshot as a Message, so the normal message renderer can draw it (text, images, GIF, sticker). */
export function snapshotAsMessage(snap: MessageSnapshot): Message {
  return {
    id: snap.message_id,
    author_id: snap.author_id,
    channel_id: snap.channel_id,
    conversation_id: snap.conversation_id,
    content: snap.content ?? "",
    image_url: snap.image_url,
    file_url: snap.file_url,
    file_name: snap.file_name,
    created_at: snap.created_at,
    updated_at: snap.edited_at,
    reply_to_id: null,
    mention_author: false,
    pinned: false,
    pinned_at: null,
    kept: false,
    forward_snapshot: snap.forward_snapshot,
    gif: snap.gif ?? null,
    sticker: snap.sticker ?? null,
  };
}

/** The link that opens a reported channel message in place, or null for DMs / missing ones. */
export function jumpLink(channelId: string | null, messageId: string | null): string | null {
  return channelId && messageId ? `/channels/${channelId}?msg=${messageId}` : null;
}

/**
 * The server a server report is about, if it still exists: `reports.server_id` is set to null when
 * the server is deleted (on delete set null), so the report row itself answers "is it still there".
 * Its current name when known (servers the admin can read), else the name at report time.
 * Null for a deleted server and for other kinds of report.
 */
export function reportedServer(
  r: Pick<ReportRow, "kind" | "server_id" | "snapshot">,
  currentNames: ReadonlyMap<string, string>,
): { id: string; name: string } | null {
  if (r.kind !== "server" || !r.server_id) return null;
  return { id: r.server_id, name: currentNames.get(r.server_id) ?? (r.snapshot as ServerSnapshot).name };
}
