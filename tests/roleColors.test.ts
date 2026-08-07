import { describe, it, expect } from "vitest";
import { ROLE_COLORS, validateHexColor } from "@/lib/roleColors";

describe("roleColors", () => {
  it("exposes a non-empty preset palette of hex colors", () => {
    expect(ROLE_COLORS.length).toBeGreaterThanOrEqual(6);
    for (const c of ROLE_COLORS) expect(validateHexColor(c)).toBe(true);
  });
  it("validateHexColor accepts #rgb and #rrggbb (any case)", () => {
    expect(validateHexColor("#abc")).toBe(true);
    expect(validateHexColor("#AABBCC")).toBe(true);
    expect(validateHexColor("#7c9cff")).toBe(true);
  });
  it("validateHexColor rejects malformed input", () => {
    expect(validateHexColor("abc")).toBe(false);
    expect(validateHexColor("#gggggg")).toBe(false);
    expect(validateHexColor("#12")).toBe(false);
    expect(validateHexColor("")).toBe(false);
  });
});
