import { describe, it, expect } from "vitest";
import { canManageRole } from "@/lib/roles";

describe("canManageRole", () => {
  it("owner can manage", () => {
    expect(canManageRole({ isOwner: true, role: "member" })).toBe(true);
  });
  it("admin can manage", () => {
    expect(canManageRole({ isOwner: false, role: "admin" })).toBe(true);
  });
  it("plain member cannot manage", () => {
    expect(canManageRole({ isOwner: false, role: "member" })).toBe(false);
  });
});
