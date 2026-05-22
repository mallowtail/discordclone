import { describe, it, expect } from "vitest";
import { formatTime } from "@/lib/format";

describe("formatTime", () => {
  it("formats an ISO timestamp as HH:MM (24h)", () => {
    expect(formatTime("2026-05-22T09:05:00Z", "UTC")).toBe("09:05");
  });
  it("pads single-digit minutes", () => {
    expect(formatTime("2026-05-22T23:07:00Z", "UTC")).toBe("23:07");
  });
});
