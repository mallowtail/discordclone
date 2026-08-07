import { describe, it, expect } from "vitest";
import { canManageRoleClient, canTogglePermClient } from "@/lib/roleHierarchy";
import { canEditRoleClient } from "@/lib/roleHierarchy";

describe("canManageRoleClient", () => {
  it("owner can manage any role", () => {
    expect(canManageRoleClient(999, null, true)).toBe(true);
    expect(canManageRoleClient(5, 3, true)).toBe(true);
  });
  it("non-owner can manage roles strictly below their rank", () => {
    expect(canManageRoleClient(3, 5, false)).toBe(true);
  });
  it("non-owner cannot manage a role at or above their rank", () => {
    expect(canManageRoleClient(5, 5, false)).toBe(false);
    expect(canManageRoleClient(8, 5, false)).toBe(false);
  });
  it("non-owner with no rank cannot manage anything", () => {
    expect(canManageRoleClient(1, null, false)).toBe(false);
  });
});

describe("canTogglePermClient", () => {
  it("owner can toggle any permission", () => {
    expect(canTogglePermClient("manage_server", [], true)).toBe(true);
  });
  it("non-owner can toggle a permission they hold", () => {
    expect(canTogglePermClient("manage_channels", ["manage_channels"], false)).toBe(true);
  });
  it("non-owner cannot toggle a permission they lack", () => {
    expect(canTogglePermClient("manage_server", ["manage_channels"], false)).toBe(false);
  });
});

describe("canEditRoleClient", () => {
  it("owner can edit any role", () => {
    expect(canEditRoleClient(["manage_server"], 999, [], null, true)).toBe(true);
  });
  it("non-owner can edit a below-rank role whose perms are a subset of theirs", () => {
    expect(canEditRoleClient(["manage_channels"], 3, ["manage_channels", "manage_roles"], 5, false)).toBe(true);
  });
  it("non-owner cannot edit a below-rank role that holds a perm they lack", () => {
    expect(canEditRoleClient(["manage_server"], 3, ["manage_channels", "manage_roles"], 5, false)).toBe(false);
  });
  it("non-owner cannot edit a role at or above their rank", () => {
    expect(canEditRoleClient([], 5, ["manage_roles"], 5, false)).toBe(false);
    expect(canEditRoleClient([], 8, ["manage_roles"], 5, false)).toBe(false);
  });
  it("non-owner with no rank cannot edit anything", () => {
    expect(canEditRoleClient([], 1, ["manage_roles"], null, false)).toBe(false);
  });
});
