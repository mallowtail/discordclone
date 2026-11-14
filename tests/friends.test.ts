import { describe, it, expect } from "vitest";
import { sortFriendships, relationTo, sendResultMessage, escapeLike, type FriendshipRow } from "@/lib/friends";
import type { Profile } from "@/types/db";

const p = (id: string, display_name = id): Profile => ({
  id, username: id, display_name, avatar_url: null, bio: null, status: null, recent_emojis: [], trusted_domains: [], created_at: "2026-01-01T00:00:00Z",
});
const row = (requester: string, addressee: string, status: "pending" | "accepted", created_at = "2026-01-01T00:00:00Z"): FriendshipRow => ({
  requester, addressee, status, created_at, accepted_at: status === "accepted" ? created_at : null,
  requester_profile: p(requester, requester.toUpperCase()), addressee_profile: p(addressee, addressee.toUpperCase()),
});

describe("sortFriendships", () => {
  it("splits rows into friends, incoming and outgoing from my side, showing the other person", () => {
    const rows = [row("me", "bo", "accepted"), row("al", "me", "accepted"), row("cy", "me", "pending"), row("me", "di", "pending")];
    const s = sortFriendships(rows, "me");
    expect(s.friends.map((f) => f.id)).toEqual(["al", "bo"]);
    expect(s.incoming.map((f) => f.id)).toEqual(["cy"]);
    expect(s.outgoing.map((f) => f.id)).toEqual(["di"]);
  });
  it("sorts friends by name ignoring case, and requests newest first", () => {
    const rows = [
      { ...row("me", "x", "accepted"), addressee_profile: p("x", "zed") },
      { ...row("me", "y", "accepted"), addressee_profile: p("y", "Amy") },
      row("old", "me", "pending", "2026-01-01T00:00:00Z"),
      row("new", "me", "pending", "2026-03-01T00:00:00Z"),
    ];
    const s = sortFriendships(rows, "me");
    expect(s.friends.map((f) => f.display_name)).toEqual(["Amy", "zed"]);
    expect(s.incoming.map((f) => f.id)).toEqual(["new", "old"]);
  });
  it("skips rows whose profile didn't load", () => {
    const broken = { ...row("me", "gone", "accepted"), addressee_profile: null as unknown as Profile };
    expect(sortFriendships([broken], "me").friends).toEqual([]);
  });
});

describe("relationTo", () => {
  const rows = [row("me", "bo", "accepted"), row("cy", "me", "pending"), row("me", "di", "pending")];
  it("names how I relate to someone", () => {
    expect(relationTo(rows, "me", "me")).toBe("self");
    expect(relationTo(rows, "me", "bo")).toBe("friends");
    expect(relationTo(rows, "me", "cy")).toBe("incoming");
    expect(relationTo(rows, "me", "di")).toBe("outgoing");
    expect(relationTo(rows, "me", "zz")).toBe("none");
  });
});

describe("sendResultMessage", () => {
  it("explains each outcome", () => {
    expect(sendResultMessage("requested", "bo")).toBe("Friend request sent to @bo.");
    expect(sendResultMessage("accepted", "bo")).toBe("@bo had already sent you a request — you're now friends!");
    expect(sendResultMessage("already_friends", "bo")).toBe("You're already friends with @bo.");
    expect(sendResultMessage("already_requested", "bo")).toBe("You already sent @bo a request.");
  });
});

describe("escapeLike", () => {
  it("makes underscores and percent signs match literally", () => {
    expect(escapeLike("cool_kid")).toBe("cool\\_kid");
    expect(escapeLike("50%")).toBe("50\\%");
  });
});
