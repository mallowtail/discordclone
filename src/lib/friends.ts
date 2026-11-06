import type { Profile } from "@/types/db";

/** A friendships row with both people's profiles embedded (see FriendsProvider's select). */
export type FriendshipRow = {
  requester: string;
  addressee: string;
  status: "pending" | "accepted";
  created_at: string;
  accepted_at: string | null;
  requester_profile: Profile;
  addressee_profile: Profile;
};

export type Relation = "self" | "none" | "friends" | "incoming" | "outgoing";

export type SendResult = "requested" | "accepted" | "already_friends" | "already_requested";

/** The PostgREST select that embeds both profiles (two FKs to profiles, so each needs a hint). */
export const FRIENDSHIP_SELECT =
  "*, requester_profile:profiles!friendships_requester_fkey(*), addressee_profile:profiles!friendships_addressee_fkey(*)";

/** My friendships seen from my side: the other person in each row, grouped and sorted for display. */
export function sortFriendships(rows: FriendshipRow[], myId: string) {
  const friends: Profile[] = [];
  const incoming: { profile: Profile; at: string }[] = [];
  const outgoing: { profile: Profile; at: string }[] = [];
  for (const r of rows) {
    const mine = r.requester === myId;
    const other = mine ? r.addressee_profile : r.requester_profile;
    if (!other) continue;
    if (r.status === "accepted") friends.push(other);
    else (mine ? outgoing : incoming).push({ profile: other, at: r.created_at });
  }
  friends.sort((a, b) => a.display_name.localeCompare(b.display_name, undefined, { sensitivity: "base" }));
  const newestFirst = (list: { profile: Profile; at: string }[]) =>
    list.sort((a, b) => b.at.localeCompare(a.at)).map((x) => x.profile);
  return { friends, incoming: newestFirst(incoming), outgoing: newestFirst(outgoing) };
}

/** How I relate to `otherId`, for picking the right friend button. */
export function relationTo(rows: FriendshipRow[], myId: string, otherId: string): Relation {
  if (otherId === myId) return "self";
  const r = rows.find(
    (x) => (x.requester === myId && x.addressee === otherId) || (x.requester === otherId && x.addressee === myId)
  );
  if (!r) return "none";
  if (r.status === "accepted") return "friends";
  return r.requester === myId ? "outgoing" : "incoming";
}

export function sendResultMessage(result: SendResult, username: string): string {
  switch (result) {
    case "requested":
      return `Friend request sent to @${username}.`;
    case "accepted":
      return `@${username} had already sent you a request — you're now friends!`;
    case "already_friends":
      return `You're already friends with @${username}.`;
    case "already_requested":
      return `You already sent @${username} a request.`;
  }
}

/** Escape LIKE wildcards so a username like `cool_kid` matches only itself. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
