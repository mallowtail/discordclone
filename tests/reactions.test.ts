import { describe, it, expect } from "vitest";
import { aggregateReactions } from "@/lib/reactions";
import type { Reaction } from "@/types/db";

function r(user_id: string, emoji: string): Reaction {
  return { message_id: "m1", user_id, emoji, created_at: "2026-06-05T00:00:00Z" };
}

describe("aggregateReactions", () => {
  it("counts reactions per emoji", () => {
    const pills = aggregateReactions([r("a", "👍"), r("b", "👍"), r("c", "❤️")], "z");
    expect(pills).toContainEqual({ emoji: "👍", count: 2, mine: false });
    expect(pills).toContainEqual({ emoji: "❤️", count: 1, mine: false });
  });
  it("marks mine when the current user reacted", () => {
    const pills = aggregateReactions([r("a", "👍"), r("me", "👍")], "me");
    expect(pills).toEqual([{ emoji: "👍", count: 2, mine: true }]);
  });
  it("returns an empty array for no reactions", () => {
    expect(aggregateReactions([], "me")).toEqual([]);
  });
});
