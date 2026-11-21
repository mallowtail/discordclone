// "Keep this message" (migration 0054, Call 7): a kept message is never deleted by the database
// safety net and its upload isn't expired after 30 days. The database (`set_message_kept`) decides
// who may; this only chooses when the menu item shows.

import { BANNED_ACCOUNT_MESSAGE } from "@/lib/users/account";

/**
 * Shows for: your own message; in a server also when you hold Manage Messages; in a DM or group
 * any member (everyone who sees the conversation is in it). Never for a message still sending.
 */
export function canKeepMessage(opts: {
  isMine: boolean;
  /** The message is in a server channel (else a DM / group). */
  inServer: boolean;
  canManageMessages: boolean;
  pending?: boolean;
}): boolean {
  if (opts.pending) return false;
  if (opts.isMine) return true;
  return opts.inServer ? opts.canManageMessages : true;
}

/** The "…" menu label. */
export function keepLabel(kept: boolean): string {
  return kept ? "Don't keep" : "Keep this message";
}

/** User-facing text for a failed `set_message_kept`. */
export function keepErrorMessage(message: string | undefined, keep: boolean): string {
  if (message?.includes("not permitted")) return "You can't change that for this message.";
  if (message?.includes("message not found")) return "That message isn't there anymore.";
  if (message?.includes("this account has been banned")) return BANNED_ACCOUNT_MESSAGE;
  if (message?.includes("this account was deleted")) return "This account was deleted.";
  return keep ? "Couldn't keep it — try again" : "Couldn't change that — try again";
}
