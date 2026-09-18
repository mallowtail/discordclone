import { describe, it, expect } from "vitest";
import { avatarColor, initials } from "@/lib/avatarColor";

const HEX_PAIR = /^#[0-9a-fA-F]{6}$/;

describe("avatarColor", () => {
  it("is deterministic: the same seed always returns the same pair", () => {
    expect(avatarColor("user-1")).toEqual(avatarColor("user-1"));
    expect(avatarColor("00000000-0000-0000-0000-000000000000")).toEqual(
      avatarColor("00000000-0000-0000-0000-000000000000")
    );
  });

  it("distributes several distinct seeds across more than one palette entry", () => {
    const seeds = ["alice", "bob", "carol", "dave", "erin", "frank", "grace", "heidi", "ivan", "judy"];
    const bgColors = new Set(seeds.map((seed) => avatarColor(seed).bg));
    expect(bgColors.size).toBeGreaterThan(1);
  });

  it("every palette entry is a valid hex pair, and the full 8-entry palette is reachable", () => {
    const seen = new Map<string, { bg: string; fg: string }>();
    for (let i = 0; i < 1000 && seen.size < 8; i++) {
      const pair = avatarColor(`seed-${i}`);
      expect(pair.bg).toMatch(HEX_PAIR);
      expect(pair.fg).toMatch(HEX_PAIR);
      seen.set(pair.bg, pair);
    }
    expect(seen.size).toBe(8);
  });
});

describe("initials", () => {
  it("returns the first and last word's initial for a multi-word name", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
  });

  it("uses only the first and last words when there are more than two", () => {
    expect(initials("Mary Jane Watson")).toBe("MW");
  });

  it("returns a single initial for a single-word name", () => {
    expect(initials("Cher")).toBe("C");
  });

  it("collapses extra whitespace between and around words", () => {
    expect(initials("  Ada    Lovelace  ")).toBe("AL");
  });

  it("returns '?' for null, undefined, empty, or whitespace-only input", () => {
    expect(initials(null)).toBe("?");
    expect(initials(undefined)).toBe("?");
    expect(initials("")).toBe("?");
    expect(initials("   ")).toBe("?");
  });

  it("handles non-ASCII letters without throwing", () => {
    expect(() => initials("Éowyn Øst")).not.toThrow();
    expect(initials("Éowyn Øst")).toBe("ÉØ");
  });
});
