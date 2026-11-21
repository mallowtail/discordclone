import { describe, expect, it } from "vitest";
import { CALL_GRACE_MS, isStaleCall } from "@/lib/voice/calls";

const now = Date.parse("2026-11-21T10:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

describe("isStaleCall", () => {
  it("is stale when the room is empty and the call isn't new", () => {
    expect(isStaleCall(ago(CALL_GRACE_MS), 0, now)).toBe(true);
    expect(isStaleCall(ago(3600_000), 0, now)).toBe(true);
  });
  it("is live while someone's in the room", () => {
    expect(isStaleCall(ago(3600_000), 1, now)).toBe(false);
  });
  it("gives a just-started call time for people to connect", () => {
    expect(isStaleCall(ago(CALL_GRACE_MS - 1), 0, now)).toBe(false);
  });
  it("never guesses when LiveKit couldn't be asked, or the date is junk", () => {
    expect(isStaleCall(ago(3600_000), null, now)).toBe(false);
    expect(isStaleCall("not a date", 0, now)).toBe(false);
  });
});
