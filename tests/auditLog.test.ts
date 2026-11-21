import { describe, it, expect } from "vitest";
import { describeAuditEntry, type AuditEntry } from "@/lib/servers/auditLog";

const e = (action: AuditEntry["action"], extra: Partial<AuditEntry> = {}): AuditEntry => ({
  id: "1", action, reason: null, until: null, created_at: "2026-11-21T10:00:00Z",
  actor: { id: "u1", display_name: "Sam" }, target: { id: "u2", display_name: "Alex" }, ...extra,
});

describe("describeAuditEntry", () => {
  it("says who did what to whom", () => {
    expect(describeAuditEntry(e("kick"))).toBe("Sam kicked Alex");
    expect(describeAuditEntry(e("ban"))).toBe("Sam banned Alex");
    expect(describeAuditEntry(e("unban"))).toBe("Sam unbanned Alex");
    expect(describeAuditEntry(e("timeout_removed"))).toBe("Sam removed Alex's timeout");
  });
  it("includes how long a timeout lasts", () => {
    expect(describeAuditEntry(e("timeout", { until: "2026-11-21T11:00:00Z" }))).toBe("Sam timed out Alex for 1 hour");
    expect(describeAuditEntry(e("timeout", { until: "2026-11-22T10:00:00Z" }))).toBe("Sam timed out Alex for 1 day");
    expect(describeAuditEntry(e("timeout", { until: "2026-11-21T10:10:00Z" }))).toBe("Sam timed out Alex for 10 minutes");
  });
  it("names stickers by their reason", () => {
    expect(describeAuditEntry(e("sticker_create", { reason: "sad cat", target: null }))).toBe("Sam added the sticker “sad cat”");
    expect(describeAuditEntry(e("sticker_delete", { reason: "sad cat", target: null }))).toBe("Sam deleted the sticker “sad cat”");
  });
  it("describes a moderator deleting someone's message", () => {
    expect(describeAuditEntry(e("message_delete"))).toBe("Sam deleted a message by Alex");
  });
  it("describes an ownership transfer", () => {
    expect(describeAuditEntry(e("ownership_transfer"))).toBe("Sam made Alex the owner");
  });
  it("copes with deleted accounts", () => {
    expect(describeAuditEntry(e("kick", { actor: null, target: null }))).toBe("Someone kicked a deleted user");
  });
});
