import { describe, expect, it } from "vitest";
import { formatTyping, pruneTypists, TYPING_THROTTLE_MS, TYPING_TTL_MS, type Typists } from "@/lib/typing";

describe("formatTyping", () => {
  it("returns empty string for nobody", () => {
    expect(formatTyping([])).toBe("");
  });
  it("formats one name", () => {
    expect(formatTyping(["Alex"])).toBe("Alex is typing...");
  });
  it("formats two names", () => {
    expect(formatTyping(["Alex", "Sam"])).toBe("Alex and Sam are typing...");
  });
  it("formats three names with an Oxford comma", () => {
    expect(formatTyping(["Alex", "Sam", "Daniel"])).toBe("Alex, Sam, and Daniel are typing...");
  });
  it("collapses four or more names", () => {
    expect(formatTyping(["Alex", "Sam", "Daniel", "Jo"])).toBe("Several people are typing...");
    expect(formatTyping(["A", "B", "C", "D", "E"])).toBe("Several people are typing...");
  });
});

describe("pruneTypists", () => {
  const t: Typists = { u1: { name: "Alex", at: 1000 } };
  it("keeps an entry younger than the ttl", () => {
    expect(pruneTypists(t, 1000 + 4999)).toEqual(t);
  });
  it("drops an entry at exactly the ttl", () => {
    expect(pruneTypists(t, 1000 + 5000)).toEqual({});
  });
  it("only drops the stale entries and honours a custom ttl", () => {
    const mixed: Typists = { a: { name: "A", at: 0 }, b: { name: "B", at: 900 } };
    expect(pruneTypists(mixed, 1000, 500)).toEqual({ b: { name: "B", at: 900 } });
  });
  it("returns the same object when nothing was pruned", () => {
    expect(pruneTypists(t, 1500)).toBe(t);
  });
});

describe("constants", () => {
  it("uses the agreed throttle and ttl", () => {
    expect(TYPING_THROTTLE_MS).toBe(2500);
    expect(TYPING_TTL_MS).toBe(5000);
  });
});
