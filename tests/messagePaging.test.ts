import { describe, it, expect } from "vitest";
import { mergeMessages, hasMoreAfter, nextHasMore, MESSAGE_PAGE } from "@/lib/messagePaging";
import type { Message } from "@/types/db";

function msg(id: string, created_at: string, extra: Partial<Message> = {}): Message {
  return {
    id,
    author_id: "alice",
    channel_id: "c",
    conversation_id: null,
    content: `content ${id}`,
    image_url: null,
    file_url: null,
    file_name: null,
    created_at,
    updated_at: null,
    reply_to_id: null,
    mention_author: false,
    pinned: false,
    pinned_at: null,
    forward_snapshot: null,
    ...extra,
  };
}

const m1 = msg("m1", "2026-10-30T10:00:00Z");
const m2 = msg("m2", "2026-10-30T10:01:00Z");
const m3 = msg("m3", "2026-10-30T10:02:00Z");
const m4 = msg("m4", "2026-10-30T10:03:00Z");

describe("mergeMessages", () => {
  it("dedupes an older page overlapping realtime rows", () => {
    expect(mergeMessages([m3, m4], [m1, m2, m3]).map((m) => m.id)).toEqual(["m1", "m2", "m3", "m4"]);
  });

  it("keeps created_at order when incoming is newer", () => {
    expect(mergeMessages([m1], [m2]).map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("incoming non-pending replaces pending with same id", () => {
    const pending = msg("p", "2026-10-30T10:05:00Z", { pending: true, content: "draft" });
    const confirmed = msg("p", "2026-10-30T10:05:01Z", { content: "sent" });
    const out = mergeMessages([m1, pending], [confirmed]);
    expect(out).toHaveLength(2);
    expect(out[1].pending).toBeFalsy();
    expect(out[1].content).toBe("sent");
  });

  it("pending never overwrites confirmed row", () => {
    const confirmed = msg("p", "2026-10-30T10:05:01Z", { content: "sent" });
    const pending = msg("p", "2026-10-30T10:05:00Z", { pending: true, content: "draft" });
    const out = mergeMessages([confirmed], [pending]);
    expect(out).toHaveLength(1);
    expect(out[0].pending).toBeFalsy();
    expect(out[0].content).toBe("sent");
  });

  it("is stable for equal timestamps and returns a new array", () => {
    const a = msg("a", "2026-10-30T10:00:00Z");
    const b = msg("b", "2026-10-30T10:00:00Z");
    const prev = [a, b];
    const out = mergeMessages(prev, []);
    expect(out).not.toBe(prev);
    expect(out.map((m) => m.id)).toEqual(["a", "b"]);
  });
});

describe("hasMoreAfter", () => {
  it("is true only when the page was full", () => {
    expect(hasMoreAfter(50, 50)).toBe(true);
    expect(hasMoreAfter(49, 50)).toBe(false);
    expect(hasMoreAfter(0, 50)).toBe(false);
  });

  it("uses a page size of 50", () => {
    expect(MESSAGE_PAGE).toBe(50);
  });
});

describe("nextHasMore", () => {
  const full = Array.from({ length: MESSAGE_PAGE }, (_, i) => i);
  it("keeps the previous value when the fetch errored", () => {
    expect(nextHasMore(true, { data: null, error: new Error("network") }, MESSAGE_PAGE)).toBe(true);
    expect(nextHasMore(false, { data: null, error: new Error("network") }, MESSAGE_PAGE)).toBe(false);
  });
  it("keeps the previous value when data is missing without an error", () => {
    expect(nextHasMore(true, { data: null, error: null }, MESSAGE_PAGE)).toBe(true);
  });
  it("ignores partial data that came with an error", () => {
    expect(nextHasMore(true, { data: [], error: { message: "boom" } }, MESSAGE_PAGE)).toBe(true);
  });
  it("derives from page length on success", () => {
    expect(nextHasMore(true, { data: [], error: null }, MESSAGE_PAGE)).toBe(false);
    expect(nextHasMore(true, { data: [1, 2], error: null }, MESSAGE_PAGE)).toBe(false);
    expect(nextHasMore(false, { data: full, error: null }, MESSAGE_PAGE)).toBe(true);
  });
});
