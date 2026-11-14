import { describe, it, expect } from "vitest";
import { summarizeConversation, conversationLabel, pickerAction, groupErrorMessage, type ConversationRow } from "@/lib/users/conversations";
import type { Profile } from "@/types/db";

const p = (id: string, display_name = id): Profile => ({
  id, username: id, display_name, avatar_url: null, bio: null, status: null, recent_emojis: [], trusted_domains: [], created_at: "2026-01-01T00:00:00Z",
});
const row = (over: Partial<ConversationRow>, people: Profile[]): ConversationRow => ({
  id: "c1", is_group: true, name: null, owner_id: "me", created_at: "2026-01-01T00:00:00Z",
  conversation_members: people.map((x) => ({ user_id: x.id, profiles: x })), ...over,
});

describe("conversationLabel", () => {
  it("uses the group's name when it has one", () => {
    expect(conversationLabel(true, "Study Squad", [p("a", "Sam")])).toBe("Study Squad");
  });
  it("otherwise lists the other members by name, alphabetically", () => {
    expect(conversationLabel(true, null, [p("a", "Sam"), p("b", "alex"), p("c", "Jo")])).toBe("alex, Jo, Sam");
  });
  it("handles a group you're alone in, and a DM", () => {
    expect(conversationLabel(true, null, [])).toBe("Empty group");
    expect(conversationLabel(false, null, [p("a", "Sam")])).toBe("Sam");
    expect(conversationLabel(false, null, [])).toBe("Unknown user");
  });
});

describe("summarizeConversation", () => {
  it("splits me from the others and labels it", () => {
    const s = summarizeConversation(row({}, [p("me", "Me"), p("b", "Bo"), p("a", "Al")]), "me");
    expect(s.others.map((x) => x.id)).toEqual(["a", "b"]);
    expect(s.members).toHaveLength(3);
    expect(s.label).toBe("Al, Bo");
    expect(s.isGroup).toBe(true);
    expect(s.ownerId).toBe("me");
  });
  it("skips members whose profile is missing", () => {
    const r = row({}, [p("me")]);
    r.conversation_members.push({ user_id: "ghost", profiles: null });
    expect(summarizeConversation(r, "me").members.map((x) => x.id)).toEqual(["me"]);
  });
});

describe("pickerAction", () => {
  it("starting something new: one person is a DM, two to nine is a group", () => {
    expect(pickerAction(0, { mode: "new" })).toMatchObject({ disabled: true });
    expect(pickerAction(1, { mode: "new" })).toMatchObject({ label: "Start DM", disabled: false });
    expect(pickerAction(2, { mode: "new" })).toMatchObject({ label: "Create Group", disabled: false });
    expect(pickerAction(9, { mode: "new" })).toMatchObject({ label: "Create Group", disabled: false });
    expect(pickerAction(10, { mode: "new" })).toMatchObject({ disabled: true, hint: "Groups can have up to 10 people, including you." });
  });
  it("adding to a group: limited by the spots left", () => {
    expect(pickerAction(0, { mode: "add", currentSize: 8 })).toMatchObject({ disabled: true });
    expect(pickerAction(2, { mode: "add", currentSize: 8 })).toMatchObject({ label: "Add 2 people", disabled: false });
    expect(pickerAction(1, { mode: "add", currentSize: 8 })).toMatchObject({ label: "Add 1 person" });
    expect(pickerAction(3, { mode: "add", currentSize: 8 })).toMatchObject({ disabled: true, hint: "Only 2 more people fit in this group." });
  });
});

describe("groupErrorMessage", () => {
  it("turns server errors into plain words", () => {
    expect(groupErrorMessage("group is full")).toBe("That would make the group bigger than 10 people.");
    expect(groupErrorMessage("not reachable")).toBe("You can only add people you're friends with or share a server or group with.");
    expect(groupErrorMessage("anything else")).toBe("Something went wrong — try again.");
  });
});
