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
