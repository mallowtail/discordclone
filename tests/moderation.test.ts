import { describe, it, expect } from "vitest";
import { canModerate, TIMEOUT_PRESETS } from "@/lib/moderation";

const base = { isOwner: false, hasPerm: true, viewerRank: 5, targetRank: 2, targetIsOwner: false, targetIsSelf: false };

describe("canModerate", () => {
  it("permitted mod acts on a strictly-lower rank", () => {
    expect(canModerate(base)).toBe(true);
  });
  it("blocks equal rank", () => {
    expect(canModerate({ ...base, targetRank: 5 })).toBe(false);
  });
  it("blocks higher rank", () => {
    expect(canModerate({ ...base, targetRank: 9 })).toBe(false);
  });
  it("blocks self even with permission", () => {
    expect(canModerate({ ...base, targetIsSelf: true })).toBe(false);
  });
  it("blocks acting on the owner even for the owner", () => {
    expect(canModerate({ ...base, isOwner: true, targetIsOwner: true })).toBe(false);
  });
  it("owner may act on a lower member without the explicit permission", () => {
    expect(canModerate({ ...base, isOwner: true, hasPerm: false })).toBe(true);
  });
  it("non-owner without the permission is blocked", () => {
    expect(canModerate({ ...base, hasPerm: false })).toBe(false);
  });
  it("roleless non-owner (rank -1) cannot act on a roleless target (rank -1)", () => {
    expect(canModerate({ ...base, viewerRank: -1, targetRank: -1 })).toBe(false);
  });
  it("exposes the five timeout presets in ascending order", () => {
    expect(TIMEOUT_PRESETS.map((p) => p.label)).toEqual(["5 min", "10 min", "1 hour", "1 day", "1 week"]);
    expect(TIMEOUT_PRESETS[0].ms).toBe(5 * 60_000);
    expect(TIMEOUT_PRESETS[4].ms).toBe(7 * 24 * 60 * 60_000);
  });
});
