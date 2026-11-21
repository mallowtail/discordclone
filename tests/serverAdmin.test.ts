import { describe, it, expect } from "vitest";
import { deleteServerErrorMessage, serverNameMatches, transferCandidates, transferErrorMessage } from "@/lib/servers/serverAdmin";

describe("serverNameMatches", () => {
  it("needs the exact name (surrounding spaces ignored)", () => {
    expect(serverNameMatches("Mallow Club", "Mallow Club")).toBe(true);
    expect(serverNameMatches("  Mallow Club ", "Mallow Club")).toBe(true);
    expect(serverNameMatches("mallow club", "Mallow Club")).toBe(false);
    expect(serverNameMatches("", "Mallow Club")).toBe(false);
  });
});

describe("transferCandidates", () => {
  const p = (id: string, name: string, deleted_at: string | null = null) => ({ id, display_name: name, username: name.toLowerCase(), deleted_at });
  it("leaves out the owner, deleted accounts and rows without a profile, sorted by name", () => {
    const rows = [
      { user_id: "o", profile: p("o", "Owner") },
      { user_id: "b", profile: p("b", "bea") },
      { user_id: "x", profile: p("x", "Deleted User", "2026-11-21T10:00:00Z") },
      { user_id: "a", profile: p("a", "Al") },
      { user_id: "n", profile: null },
    ];
    expect(transferCandidates(rows, "o").map((r) => r.user_id)).toEqual(["a", "b"]);
  });
});

describe("transferErrorMessage", () => {
  it("maps the database errors", () => {
    expect(transferErrorMessage("only the owner can do that")).toBe("Only the owner can pass on ownership.");
    expect(transferErrorMessage("you already own this server")).toBe("You already own this server.");
    expect(transferErrorMessage("not a member")).toBe("That person isn't in this server anymore.");
  });
  it("falls back to a generic message", () => {
    expect(transferErrorMessage(undefined)).toBe("Couldn't transfer ownership — try again.");
  });
});

describe("deleteServerErrorMessage", () => {
  it("maps the database error", () => {
    expect(deleteServerErrorMessage("only the owner can delete the server")).toBe("Only the owner can delete the server.");
  });
  it("falls back to a generic message", () => {
    expect(deleteServerErrorMessage("boom")).toBe("Couldn't delete the server — try again.");
  });
});
