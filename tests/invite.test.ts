import { describe, it, expect } from "vitest";
import { inviteUrl, safeNext, parseInviteCode } from "@/lib/invite";

describe("inviteUrl", () => {
  it("builds a full invite URL from an explicit origin", () => {
    expect(inviteUrl("a1b2c3d4e5", "https://chat.example.com")).toBe(
      "https://chat.example.com/invite/a1b2c3d4e5"
    );
  });

  it("does not double a trailing slash on the origin", () => {
    expect(inviteUrl("abc", "https://chat.example.com/")).toBe(
      "https://chat.example.com/invite/abc"
    );
  });
});

describe("safeNext", () => {
  it("allows a same-origin relative path", () => {
    expect(safeNext("/invite/abc")).toBe("/invite/abc");
  });
  it("rejects an absolute URL", () => {
    expect(safeNext("https://evil.com")).toBe("/channels/first");
  });
  it("rejects a protocol-relative URL", () => {
    expect(safeNext("//evil.com")).toBe("/channels/first");
  });
  it("rejects a backslash-tricked path", () => {
    expect(safeNext("/\\evil.com")).toBe("/channels/first");
  });
  it("falls back when null", () => {
    expect(safeNext(null)).toBe("/channels/first");
  });
});

describe("parseInviteCode", () => {
  it("returns a bare code unchanged", () => {
    expect(parseInviteCode("x7Kp9q")).toBe("x7Kp9q");
  });
  it("extracts the code from a full invite URL", () => {
    expect(parseInviteCode("https://chat.example.com/invite/x7Kp9q")).toBe("x7Kp9q");
  });
  it("ignores a trailing slash", () => {
    expect(parseInviteCode("https://chat.example.com/invite/x7Kp9q/")).toBe("x7Kp9q");
  });
  it("ignores query/hash after the code", () => {
    expect(parseInviteCode("http://localhost:3000/invite/abc?x=1#y")).toBe("abc");
  });
  it("trims surrounding whitespace", () => {
    expect(parseInviteCode("  x7Kp9q  ")).toBe("x7Kp9q");
  });
  it("returns null for empty input", () => {
    expect(parseInviteCode("   ")).toBeNull();
  });
});

import {
  validateVanityCode,
  inviteStatus,
  formatTimeLeft,
  EXPIRY_OPTIONS,
  MAX_USES_OPTIONS,
  DEFAULT_EXPIRY_SECONDS,
} from "@/lib/invite";

describe("validateVanityCode", () => {
  it("accepts letters (any case), numbers and hyphens, 2–32 long", () => {
    expect(validateVanityCode("Mallow-Gang")).toEqual({ ok: true, value: "Mallow-Gang" });
    expect(validateVanityCode("ab")).toEqual({ ok: true, value: "ab" });
    expect(validateVanityCode("x".repeat(32)).ok).toBe(true);
  });
  it("trims surrounding spaces", () => {
    expect(validateVanityCode("  cool-club  ")).toEqual({ ok: true, value: "cool-club" });
  });
  it("rejects too short, too long, and other characters", () => {
    for (const bad of ["a", "", "x".repeat(33), "no spaces", "under_score", "emoji🙂", "slash/es"]) {
      expect(validateVanityCode(bad).ok).toBe(false);
    }
  });
});

describe("inviteStatus", () => {
  const now = new Date("2026-11-06T12:00:00Z");
  it("is ok with no expiry and no limit", () => {
    expect(inviteStatus({ expires_at: null, max_uses: null, uses: 999 }, now)).toBe("ok");
  });
  it("is expired at or after the expiry moment", () => {
    expect(inviteStatus({ expires_at: "2026-11-06T12:00:00Z", max_uses: null, uses: 0 }, now)).toBe("expired");
    expect(inviteStatus({ expires_at: "2026-11-06T11:59:00Z", max_uses: null, uses: 0 }, now)).toBe("expired");
    expect(inviteStatus({ expires_at: "2026-11-06T12:01:00Z", max_uses: null, uses: 0 }, now)).toBe("ok");
  });
  it("is used_up once uses reach the limit (a one-time link after one join)", () => {
    expect(inviteStatus({ expires_at: null, max_uses: 1, uses: 0 }, now)).toBe("ok");
    expect(inviteStatus({ expires_at: null, max_uses: 1, uses: 1 }, now)).toBe("used_up");
  });
  it("reports expired before used_up when both apply", () => {
    expect(inviteStatus({ expires_at: "2026-11-06T11:00:00Z", max_uses: 1, uses: 1 }, now)).toBe("expired");
  });
});

describe("formatTimeLeft", () => {
  const now = new Date("2026-11-06T12:00:00Z");
  const at = (ms: number) => new Date(now.getTime() + ms).toISOString();
  it("shows Never / Expired", () => {
    expect(formatTimeLeft(null, now)).toBe("Never");
    expect(formatTimeLeft(at(-1000), now)).toBe("Expired");
  });
  it("rounds minutes up so it never says 0m", () => {
    expect(formatTimeLeft(at(10_000), now)).toBe("1m");
    expect(formatTimeLeft(at(45 * 60_000), now)).toBe("45m");
  });
  it("uses hours under a day and days beyond", () => {
    expect(formatTimeLeft(at(90 * 60_000), now)).toBe("1h");
    expect(formatTimeLeft(at(23 * 3_600_000), now)).toBe("23h");
    expect(formatTimeLeft(at(7 * 86_400_000), now)).toBe("7d");
  });
});

describe("invite option lists", () => {
  it("offers Discord-style expiry choices, defaulting to 7 days, including Never", () => {
    expect(EXPIRY_OPTIONS.map((o) => o.seconds)).toEqual([1800, 3600, 21600, 43200, 86400, 604800, null]);
    expect(DEFAULT_EXPIRY_SECONDS).toBe(604800);
  });
  it("offers No limit, a one-time option, and larger caps", () => {
    expect(MAX_USES_OPTIONS.map((o) => o.uses)).toEqual([null, 1, 5, 10, 25, 50, 100]);
  });
});
