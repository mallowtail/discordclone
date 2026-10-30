import { describe, it, expect } from "vitest";
import { aggregateReactions, upsertReaction, removeReaction, chunkIds, REACTION_ID_CHUNK } from "@/lib/reactions";
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

describe("upsertReaction", () => {
  it("appends a new reaction", () => {
    expect(upsertReaction([r("a", "👍")], r("b", "👍"))).toEqual([r("a", "👍"), r("b", "👍")]);
  });
  it("does not duplicate a reaction already present (same message/user/emoji)", () => {
    const rows = [r("a", "👍")];
    expect(upsertReaction(rows, r("a", "👍"))).toBe(rows); // unchanged reference, no dup
  });
  it("treats a different emoji from the same user as distinct", () => {
    expect(upsertReaction([r("a", "👍")], r("a", "❤️"))).toHaveLength(2);
  });
});

describe("removeReaction", () => {
  it("removes the reaction matching the PK", () => {
    expect(removeReaction([r("a", "👍"), r("b", "👍")], r("a", "👍"))).toEqual([r("b", "👍")]);
  });
  it("leaves other emojis/users untouched", () => {
    const rows = [r("a", "👍"), r("a", "❤️")];
    expect(removeReaction(rows, { message_id: "m1", user_id: "a", emoji: "👍" })).toEqual([r("a", "❤️")]);
  });
  it("is a no-op when nothing matches", () => {
    expect(removeReaction([r("a", "👍")], r("z", "👍"))).toEqual([r("a", "👍")]);
  });
});

describe("chunkIds", () => {
  it("returns no chunks for no ids", () => {
    expect(chunkIds([], 100)).toEqual([]);
  });
  it("keeps a short list as one chunk", () => {
    expect(chunkIds(["a", "b"], 100)).toEqual([["a", "b"]]);
  });
  it("splits into chunks of at most `size`, preserving order", () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id${i}`);
    const chunks = chunkIds(ids, 100);
    expect(chunks.map((c) => c.length)).toEqual([100, 100, 50]);
    expect(chunks.flat()).toEqual(ids);
  });
  it("an exact multiple makes no empty trailing chunk", () => {
    expect(chunkIds(["a", "b", "c", "d"], 2)).toEqual([["a", "b"], ["c", "d"]]);
  });
  it("defaults to REACTION_ID_CHUNK", () => {
    const ids = Array.from({ length: REACTION_ID_CHUNK + 1 }, (_, i) => String(i));
    expect(chunkIds(ids).map((c) => c.length)).toEqual([REACTION_ID_CHUNK, 1]);
  });
  it("rejects a non-positive size", () => {
    expect(() => chunkIds(["a"], 0)).toThrow(RangeError);
  });
});
