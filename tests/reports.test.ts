import { describe, it, expect } from "vitest";
import {
  REPORT_NOTE_MAX, REPORT_REASONS, REPORT_SENT_MESSAGE, badgeLabel, handleReportErrorMessage, jumpLink, modDeleteErrorMessage,
  openReportCount, personName, reasonLabel, reportErrorMessage, reportTitle, snapshotAsMessage, snapshotAuthor, snapshotPlace,
  sortReports, type MessageSnapshot,
} from "@/lib/reports/reports";

const snap: MessageSnapshot = {
  message_id: "m1", author_id: "a1", author_username: "sam", author_display_name: "Sam", author_avatar_url: "https://x/a.png",
  content: "hello", image_url: "https://x/i.png", file_url: null, file_name: null,
  gif: { url: "https://static.klipy.com/g.gif", width: 10, height: 10, title: "cat" },
  sticker: null, forward_snapshot: null, poll_options: null, created_at: "2026-11-21T10:00:00Z", edited_at: null,
  channel_id: "c1", channel_name: "general", server_id: "s1", server_name: "Mallow Club",
  conversation_id: null, is_group: null, group_name: null,
};

describe("reasons", () => {
  it("are exactly the five agreed reasons, in order", () => {
    expect(REPORT_REASONS.map((r) => [r.id, r.label])).toEqual([
      ["spam", "Spam"],
      ["harassment", "Harassment or bullying"],
      ["inappropriate", "Inappropriate content"],
      ["hate_speech", "Hate speech"],
      ["other", "Something else"],
    ]);
  });
  it("label a stored reason, and fall back for an unknown one", () => {
    expect(reasonLabel("hate_speech")).toBe("Hate speech");
    expect(reasonLabel("nope")).toBe("Something else");
  });
  it("notes are capped at 500 and the thank-you copy is agreed", () => {
    expect(REPORT_NOTE_MAX).toBe(500);
    expect(REPORT_SENT_MESSAGE).toBe("Thanks — the moderators will take a look.");
  });
  it("titles the dialog by kind", () => {
    expect(reportTitle("message")).toBe("Report message");
    expect(reportTitle("user")).toBe("Report user");
    expect(reportTitle("server")).toBe("Report server");
  });
});

describe("reportErrorMessage", () => {
  it("uses the agreed copy for the rate limit and duplicates", () => {
    expect(reportErrorMessage("slow down: too many reports")).toBe("You've sent a lot of reports — try again in a few minutes");
    expect(reportErrorMessage("already reported")).toBe("You already reported this");
  });
  it("explains the other refusals", () => {
    expect(reportErrorMessage("note too long")).toBe("Keep the note under 500 characters.");
    expect(reportErrorMessage("cannot report yourself")).toBe("You can't report yourself.");
    expect(reportErrorMessage("cannot report your own server")).toBe("You can't report your own server.");
    expect(reportErrorMessage("message not found")).toBe("That message isn't there anymore.");
    expect(reportErrorMessage("user not found")).toBe("That account isn't there anymore.");
    expect(reportErrorMessage("server not found")).toBe("That server isn't there anymore.");
    expect(reportErrorMessage("this account has been banned")).toBe("This account has been banned from Mallowchat.");
  });
  it("falls back to a generic message", () => {
    expect(reportErrorMessage("invalid report")).toBe("Couldn't send the report — try again.");
    expect(reportErrorMessage(undefined)).toBe("Couldn't send the report — try again.");
  });
});

describe("handleReportErrorMessage / modDeleteErrorMessage", () => {
  it("explain handle_report's refusals", () => {
    expect(handleReportErrorMessage("already handled")).toBe("Someone already marked this handled.");
    expect(handleReportErrorMessage("report not found")).toBe("This report isn't available to you anymore.");
    expect(handleReportErrorMessage("note too long")).toBe("Keep the note under 500 characters.");
    expect(handleReportErrorMessage("x")).toBe("Couldn't mark it handled — try again.");
  });
  it("explain delete_message_as_mod's refusals", () => {
    expect(modDeleteErrorMessage("message not found")).toBe("That message is already gone.");
    expect(modDeleteErrorMessage("not permitted")).toBe("You don't have permission to delete that message.");
    expect(modDeleteErrorMessage("this account has been banned")).toBe("This account has been banned from Mallowchat.");
    expect(modDeleteErrorMessage(undefined)).toBe("Couldn't delete — try again");
  });
});

describe("sortReports / counts", () => {
  const r = (id: string, status: "open" | "handled", created_at: string, handled_at: string | null = null) => ({ id, status, created_at, handled_at });
  it("puts open reports first, newest first, then handled by when they were handled", () => {
    const rows = [
      r("h-old", "handled", "2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z"),
      r("o-old", "open", "2026-11-01T00:00:00Z"),
      r("h-new", "handled", "2026-11-01T00:00:00Z", "2026-11-10T00:00:00Z"),
      r("o-new", "open", "2026-11-05T00:00:00Z"),
    ];
    expect(sortReports(rows).map((x) => x.id)).toEqual(["o-new", "o-old", "h-new", "h-old"]);
    expect(openReportCount(rows)).toBe(2);
  });
  it("badgeLabel hides zero and caps at 99+", () => {
    expect(badgeLabel(0)).toBeNull();
    expect(badgeLabel(3)).toBe("3");
    expect(badgeLabel(120)).toBe("99+");
  });
});

describe("snapshotAuthor", () => {
  const live = { id: "a1", username: "sam2", display_name: "Sam Now", avatar_url: null, deleted_at: null, banned_at: null };
  it("shows Deleted User when the author is now banned or deleted, not the stored name", () => {
    expect(snapshotAuthor(snap, { ...live, banned_at: "2026-11-21T00:00:00Z" })).toEqual({ name: "Deleted User", username: null, avatarUrl: null, deleted: true });
    expect(snapshotAuthor(snap, { ...live, deleted_at: "2026-11-21T00:00:00Z" }).name).toBe("Deleted User");
  });
  it("uses the live name when the account is fine, else the snapshot", () => {
    expect(snapshotAuthor(snap, live)).toEqual({ name: "Sam Now", username: "sam2", avatarUrl: null, deleted: false });
    expect(snapshotAuthor(snap, null)).toEqual({ name: "Sam", username: "sam", avatarUrl: "https://x/a.png", deleted: false });
  });
  it("personName hides deleted and banned people", () => {
    expect(personName(live)).toBe("Sam Now");
    expect(personName({ ...live, banned_at: "x" })).toBe("Deleted User");
    expect(personName(null)).toBe("Deleted User");
  });
});

describe("snapshotPlace / jumpLink", () => {
  it("names where the message was", () => {
    expect(snapshotPlace(snap)).toBe("#general in Mallow Club");
    expect(snapshotPlace({ ...snap, server_name: null })).toBe("#general");
    expect(snapshotPlace({ ...snap, channel_name: null, conversation_id: "c", is_group: true, group_name: "Pals" })).toBe("the group “Pals”");
    expect(snapshotPlace({ ...snap, channel_name: null, conversation_id: "c", is_group: true, group_name: null })).toBe("a group chat");
    expect(snapshotPlace({ ...snap, channel_name: null, conversation_id: "c", is_group: false })).toBe("a DM");
  });
  it("links channel messages only", () => {
    expect(jumpLink("c1", "m1")).toBe("/channels/c1?msg=m1");
    expect(jumpLink(null, "m1")).toBeNull();
    expect(jumpLink("c1", null)).toBeNull();
  });
});

describe("snapshotAsMessage", () => {
  it("turns the snapshot into a message the renderer can draw", () => {
    const m = snapshotAsMessage({ ...snap, edited_at: "2026-11-21T11:00:00Z" });
    expect(m).toMatchObject({
      id: "m1", author_id: "a1", channel_id: "c1", content: "hello", image_url: "https://x/i.png",
      gif: snap.gif, sticker: null, updated_at: "2026-11-21T11:00:00Z", reply_to_id: null, pinned: false,
    });
  });
  it("copes with an empty body", () => {
    expect(snapshotAsMessage({ ...snap, content: null }).content).toBe("");
  });
});
