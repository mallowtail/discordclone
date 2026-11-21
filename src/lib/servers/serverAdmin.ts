// Owner-only server actions (migration 0046): pass on ownership, delete the server.

import { BANNED_ACCOUNT_MESSAGE, isBannedAccountError } from "@/lib/users/account";

/** "Type the server's name to confirm": exact, apart from surrounding spaces. */
export function serverNameMatches(typed: string, name: string): boolean {
  const t = typed.trim();
  return t.length > 0 && t === name.trim();
}

type MemberLike = {
  user_id: string;
  profile: { display_name: string; deleted_at?: string | null; banned_at?: string | null } | null;
};

/** Members who can become the owner: everyone but the current owner and deleted or banned accounts, by name. */
export function transferCandidates<T extends MemberLike>(members: T[], ownerId: string | null): T[] {
  return members
    .filter((m) => m.user_id !== ownerId && m.profile && !m.profile.deleted_at && !m.profile.banned_at)
    .sort((a, b) => a.profile!.display_name.localeCompare(b.profile!.display_name, undefined, { sensitivity: "base" }));
}

/** User-facing text for a failed `transfer_server_ownership`. */
export function transferErrorMessage(message: string | undefined): string {
  if (message?.includes("only the owner can do that")) return "Only the owner can pass on ownership.";
  if (message?.includes("you already own this server")) return "You already own this server.";
  if (message?.includes("not a member")) return "That person isn't in this server anymore.";
  if (isBannedAccountError(message)) return BANNED_ACCOUNT_MESSAGE;
  return "Couldn't transfer ownership — try again.";
}

/** User-facing text for a failed `delete_server`. */
export function deleteServerErrorMessage(message: string | undefined): string {
  if (message?.includes("only the owner can delete the server")) return "Only the owner can delete the server.";
  return "Couldn't delete the server — try again.";
}
