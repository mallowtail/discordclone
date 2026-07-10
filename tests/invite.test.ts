import { describe, it, expect } from "vitest";
import { inviteUrl } from "@/lib/invite";

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
