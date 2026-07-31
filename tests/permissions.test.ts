import { describe, it, expect } from "vitest";
import { PERMISSIONS, PERMISSION_LABELS, isPermission } from "@/lib/permissions";

describe("permissions", () => {
  it("exposes the five permission keys", () => {
    expect(PERMISSIONS).toEqual([
      "manage_channels", "manage_server", "manage_roles", "kick_members", "manage_messages",
    ]);
  });
  it("has a label for every permission", () => {
    for (const p of PERMISSIONS) {
      expect(PERMISSION_LABELS[p]).toBeTruthy();
    }
  });
  it("isPermission accepts a valid key", () => {
    expect(isPermission("manage_channels")).toBe(true);
  });
  it("isPermission rejects an unknown key", () => {
    expect(isPermission("manage_everything")).toBe(false);
    expect(isPermission("")).toBe(false);
  });
});
