import { describe, it, expect } from "vitest";
import { serverInitials, colorFromName } from "@/lib/server-icon";

describe("serverInitials", () => {
  it("one word -> first two letters", () => {
    expect(serverInitials("test")).toBe("TE");
  });
  it("two words -> first letter of each", () => {
    expect(serverInitials("two words")).toBe("TW");
  });
  it("three+ words -> first letter of first two words", () => {
    expect(serverInitials("three two words")).toBe("TT");
  });
  it("trims and collapses extra whitespace", () => {
    expect(serverInitials("  hello   world  ")).toBe("HW");
  });
  it("single-character name -> that letter", () => {
    expect(serverInitials("x")).toBe("X");
  });
});

describe("colorFromName", () => {
  it("is stable for the same name", () => {
    expect(colorFromName("test")).toBe(colorFromName("test"));
  });
  it("differs for clearly different names", () => {
    expect(colorFromName("alpha")).not.toBe(colorFromName("zulu"));
  });
});
