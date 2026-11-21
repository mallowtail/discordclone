import { describe, it, expect } from "vitest";
import { describeAuditEntry, type AuditEntry } from "@/lib/servers/auditLog";

const e = (action: AuditEntry["action"], extra: Partial<AuditEntry> = {}): AuditEntry => ({
  id: "1", action, reason: null, until: null, created_at: "2026-11-21T10:00:00Z",
  actor: { display_name: "Sam" }, target: { display_name: "Alex" }, ...extra,
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
  it("copes with deleted accounts", () => {
    expect(describeAuditEntry(e("kick", { actor: null, target: null }))).toBe("Someone kicked a deleted user");
  });
});
