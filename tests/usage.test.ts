import { describe, it, expect } from "vitest";
import {
  parseAdminUsage, usageFraction, formatPercent, usageLevel, usageText, lastFinishedRun, describeRun,
  cleanupWarnings, runNowResultText, durationText, runTriggerLabel, type CleanupRun,
} from "@/lib/admin/usage";

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const H = 60 * 60 * 1000;
const NOW = Date.parse("2026-11-22T12:00:00Z");

function run(over: Partial<CleanupRun> = {}): CleanupRun {
  return {
    id: "r1", started_at: "2026-11-22T10:00:00+00:00", finished_at: "2026-11-22T10:00:05+00:00",
    trigger: "cron", actor_id: null, steps: [], messages_changed: 0, messages_deleted: 0, files_deleted: 0,
    bytes_freed: 0, storage_bytes: 0, database_bytes: 0, error: null, ...over,
  };
}

describe("parseAdminUsage", () => {
  it("reads admin_usage() and keeps the four buckets in order", () => {
    const u = parseAdminUsage({
      storage: { total_bytes: "300", limit_bytes: GB, warn_at: 0.8, pause_at: 0.95, paused: false,
        buckets: { stickers: 100, attachments: "200" } },
      database: { bytes: 28 * MB, limit_bytes: 500 * MB, warn_at: 0.8 },
      daily_upload_limit_bytes: 20 * MB, pending_files: 2,
      runs: [{ id: "a", started_at: "2026-11-22T10:00:00+00:00", finished_at: null, trigger: "admin",
        steps: ["age"], messages_changed: "1", files_deleted: 1, bytes_freed: 40, error: null }, { nope: 1 }],
    });
    expect(u.storage.totalBytes).toBe(300);
    expect(u.storage.buckets).toEqual([
      { id: "attachments", bytes: 200 }, { id: "avatars", bytes: 0 }, { id: "server-icons", bytes: 0 }, { id: "stickers", bytes: 100 },
    ]);
    expect(u.database.bytes).toBe(28 * MB);
    expect(u.pendingFiles).toBe(2);
    expect(u.runs).toHaveLength(1);
    expect(u.runs[0]).toMatchObject({ id: "a", finished_at: null, trigger: "admin", messages_changed: 1, messages_deleted: 0 });
  });
  it("has sane defaults for an empty reply", () => {
    const u = parseAdminUsage(null);
    expect(u.storage.limitBytes).toBe(GB);
    expect(u.storage.warnAt).toBe(0.8);
    expect(u.storage.pauseAt).toBe(0.95);
    expect(u.database.limitBytes).toBe(500 * MB);
    expect(u.runs).toEqual([]);
  });
});

describe("meters", () => {
  it("fraction, percent and level", () => {
    expect(usageFraction(250, 1000)).toBe(0.25);
    expect(usageFraction(5, 0)).toBe(0);
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(0.0004)).toBe("<0.1%");
    expect(formatPercent(0.0123)).toBe("1.2%");
    expect(formatPercent(0.8)).toBe("80%");
    expect(usageLevel(0.5, 0.8, 0.95)).toBe("ok");
    expect(usageLevel(0.8, 0.8, 0.95)).toBe("warn");
    expect(usageLevel(0.95, 0.8, 0.95)).toBe("danger");
    expect(usageLevel(0.99, 0.8)).toBe("warn");
    expect(usageText(20 * MB, GB)).toBe("20 MB of 1 GB (2%)");
  });
});

describe("runs", () => {
  it("lastFinishedRun skips unfinished ones and picks the latest finish", () => {
    const a = run({ id: "a", finished_at: "2026-11-21T10:00:00+00:00" });
    const b = run({ id: "b", finished_at: null });
    const c = run({ id: "c", finished_at: "2026-11-22T10:00:00+00:00" });
    expect(lastFinishedRun([b, a, c])?.id).toBe("c");
    expect(lastFinishedRun([b])).toBeNull();
  });
  it("describeRun", () => {
    expect(describeRun(run())).toBe("Nothing needed cleaning up.");
    expect(describeRun(run({ finished_at: null }))).toBe("Still running…");
    expect(describeRun(run({ files_deleted: 3, bytes_freed: 1.5 * MB, messages_changed: 1, steps: ["age"] })))
      .toBe("Removed 3 files (1.5 MB) · 1 message turned into text");
    expect(describeRun(run({ messages_deleted: 2, steps: ["pressure", "messages"] })))
      .toBe("2 old messages deleted (database almost full) · storage was over 80%");
  });
  it("labels and durations", () => {
    expect(runTriggerLabel(run())).toBe("Daily run");
    expect(runTriggerLabel(run({ trigger: "admin" }))).toBe("Run now (admin)");
    expect(durationText(5000)).toBe("0 minutes");
    expect(durationText(12 * 60000)).toBe("12 minutes");
    expect(durationText(27 * H)).toBe("27 hours");
    expect(durationText(72 * H)).toBe("3 days");
  });
});

describe("cleanupWarnings", () => {
  it("says none ran yet (info only)", () => {
    expect(cleanupWarnings([], NOW)).toEqual([
      { level: "info", text: "No clean-up has run yet. The daily run is at 04:00 Korea time." },
    ]);
  });
  it("is quiet for a recent clean run", () => {
    expect(cleanupWarnings([run()], NOW)).toEqual([]);
  });
  it("warns when the last finished run is older than ~26 hours", () => {
    const w = cleanupWarnings([run({ finished_at: new Date(NOW - 27 * H).toISOString() })], NOW);
    expect(w).toEqual([{ level: "danger", text: "The last clean-up finished 27 hours ago — the daily 04:00 run doesn't seem to be happening." }]);
    expect(cleanupWarnings([run({ finished_at: new Date(NOW - 25 * H).toISOString() })], NOW)).toEqual([]);
  });
  it("shows the last finished run's error", () => {
    expect(cleanupWarnings([run({ error: "age: boom" })], NOW))
      .toEqual([{ level: "danger", text: "The last clean-up had a problem: age: boom" }]);
  });
  it("flags a run that started 10+ minutes ago and never finished", () => {
    const stuck = run({ id: "s", started_at: new Date(NOW - 15 * 60000).toISOString(), finished_at: null });
    const w = cleanupWarnings([stuck, run()], NOW);
    expect(w[0].level).toBe("danger");
    expect(w[0].text).toMatch(/started 15 minutes ago and never finished/);
    expect(w).toHaveLength(1);
    // A run that only just started is fine.
    const fresh = run({ id: "f", started_at: new Date(NOW - 60000).toISOString(), finished_at: null });
    expect(cleanupWarnings([fresh, run()], NOW)).toEqual([]);
  });
});

describe("runNowResultText", () => {
  it("maps the function's replies", () => {
    expect(runNowResultText(200, { ok: true, files_deleted: 2, error: null }))
      .toEqual({ ok: true, text: "Clean-up finished — removed 2 files." });
    expect(runNowResultText(200, { ok: true, files_deleted: 0, error: null }))
      .toEqual({ ok: true, text: "Clean-up finished — nothing needed removing." });
    expect(runNowResultText(409, { ok: false, error: "a clean-up is already running" }))
      .toEqual({ ok: false, text: "A clean-up is already running — try again in a few minutes." });
    expect(runNowResultText(401, { ok: false, error: "not permitted" }))
      .toEqual({ ok: false, text: "Only the Mallowchat admin can do that." });
    expect(runNowResultText(500, { ok: false, error: "age: boom" }))
      .toEqual({ ok: false, text: "Clean-up failed: age: boom" });
    expect(runNowResultText(502, null)).toEqual({ ok: false, text: "Clean-up failed (HTTP 502)" });
    expect(runNowResultText(null, null).ok).toBe(false);
  });
});
