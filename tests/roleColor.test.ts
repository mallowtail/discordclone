import { describe, it, expect } from "vitest";
import { topRoleColor } from "@/lib/roleColor";

describe("topRoleColor", () => {
  it("returns the color of the highest-position colored role", () => {
    expect(topRoleColor([
      { position: 1, color: "#111111" },
      { position: 5, color: "#222222" },
      { position: 3, color: "#333333" },
    ])).toBe("#222222");
  });
  it("skips a higher role with no color in favor of the next colored one", () => {
    expect(topRoleColor([
      { position: 9, color: null },
      { position: 4, color: "#abcabc" },
    ])).toBe("#abcabc");
  });
  it("returns null when no role has a color", () => {
    expect(topRoleColor([{ position: 2, color: null }])).toBeNull();
    expect(topRoleColor([])).toBeNull();
  });
});
