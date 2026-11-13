import type { Profile } from "@/types/db";

/** Most people in one group, including you (enforced by the database too). */
export const MAX_GROUP_SIZE = 10;

/** A conversation with its members' profiles embedded (RLS returns only conversations you're in). */
export const CONVERSATION_SELECT = "id, is_group, name, owner_id, created_at, conversation_members(user_id, profiles(*))";

export type ConversationRow = {
  id: string;
  is_group: boolean;
  name: string | null;
  owner_id: string | null;
  created_at: string;
  conversation_members: { user_id: string; profiles: Profile | null }[];
};

export type ConversationSummary = {
  id: string;
  isGroup: boolean;
  name: string | null;
  ownerId: string | null;
  createdAt: string;
  /** Everyone, including me. */
  members: Profile[];
  /** Everyone except me, sorted by name. */
  others: Profile[];
  label: string;
};

const byName = (a: Profile, b: Profile) => a.display_name.localeCompare(b.display_name, undefined, { sensitivity: "base" });

/** What to call a conversation: a group's own name, else its other members' names; a DM is the other person. */
export function conversationLabel(isGroup: boolean, name: string | null, others: Profile[]): string {
  if (!isGroup) return others[0]?.display_name ?? "Unknown user";
  if (name) return name;
  if (others.length === 0) return "Empty group";
  return [...others].sort(byName).map((o) => o.display_name).join(", ");
}

export function summarizeConversation(row: ConversationRow, myId: string): ConversationSummary {
  const members = row.conversation_members.map((m) => m.profiles).filter((x): x is Profile => !!x);
  const others = members.filter((m) => m.id !== myId).sort(byName);
  return {
    id: row.id,
    isGroup: row.is_group,
    name: row.name,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    members,
    others,
    label: conversationLabel(row.is_group, row.name, others),
  };
}

/** The picker's main button, given how many people are ticked. */
export function pickerAction(
  count: number,
  ctx: { mode: "new" } | { mode: "add"; currentSize: number }
): { label: string; disabled: boolean; hint?: string } {
  if (ctx.mode === "add") {
    const room = MAX_GROUP_SIZE - ctx.currentSize;
    if (count > room) {
      return { label: "Add", disabled: true, hint: `Only ${room} more ${room === 1 ? "person fits" : "people fit"} in this group.` };
    }
    return { label: count === 0 ? "Add" : `Add ${count} ${count === 1 ? "person" : "people"}`, disabled: count === 0 };
  }
  if (count === 0) return { label: "Start DM", disabled: true };
  if (count === 1) return { label: "Start DM", disabled: false };
  if (count > MAX_GROUP_SIZE - 1) {
    return { label: "Create Group", disabled: true, hint: `Groups can have up to ${MAX_GROUP_SIZE} people, including you.` };
  }
  return { label: "Create Group", disabled: false };
}

/** Plain-words versions of the database's group errors. */
export function groupErrorMessage(message: string): string {
  if (message.includes("group is full")) return `That would make the group bigger than ${MAX_GROUP_SIZE} people.`;
  if (message.includes("not reachable")) return "You can only add people you're friends with or share a server or group with.";
  return "Something went wrong — try again.";
}
