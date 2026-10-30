import { describe, it, expect } from "vitest";
import { applyPinUpdate, PIN_PAGE } from "@/lib/pins";
import type { Message } from "@/types/db";

function msg(id: string, pinned_at: string | null, extra: Partial<Message> = {}): Message {
  return {
    id,
    author_id: "alice",
    channel_id: "c",
    conversation_id: null,
    content: `content ${id}`,
    image_url: null,
    file_url: null,
    file_name: null,
    created_at: "2026-10-30T09:00:00Z",
    updated_at: null,
    reply_to_id: null,
    mention_author: false,
    pinned: pinned_at !== null,
    pinned_at,
    forward_snapshot: null,
    ...extra,
  };
}

const a = msg("a", "2026-10-30T10:02:00Z");
const b = msg("b", "2026-10-30T10:01:00Z");

describe("applyPinUpdate", () => {
  it("PIN_PAGE is 20", () => {
    expect(PIN_PAGE).toBe(20);
  });

  it("applyPinUpdate inserts a newly pinned message at the top", () => {
    const c = msg("c", "2026-10-30T10:05:00Z");
    expect(applyPinUpdate([a, b], c).map((m) => m.id)).toEqual(["c", "a", "b"]);
  });

  it("applyPinUpdate sorts an older pin into place and keeps null pinned_at last", () => {
    const old = msg("old", "2026-10-30T10:00:00Z");
    const nul = msg("nul", null, { pinned: true });
    expect(applyPinUpdate(applyPinUpdate([a, b], nul), old).map((m) => m.id)).toEqual(["a", "b", "old", "nul"]);
  });

  it("applyPinUpdate does not duplicate an already-listed pin", () => {
    const edited = { ...b, content: "edited" };
    const out = applyPinUpdate([a, b], edited);
    expect(out).toHaveLength(2);
    expect(out.find((m) => m.id === "b")?.content).toBe("edited");
  });

  it("applyPinUpdate re-pin moves the row to its new pinned_at position", () => {
    const repinned = msg("b", "2026-10-30T11:00:00Z");
    expect(applyPinUpdate([a, b], repinned).map((m) => m.id)).toEqual(["b", "a"]);
  });

  it("applyPinUpdate removes on unpin", () => {
    const unpinned = msg("a", null, { pinned: false });
    expect(applyPinUpdate([a, b], unpinned).map((m) => m.id)).toEqual(["b"]);
  });

  it("applyPinUpdate on unpin of unknown id is a no-op", () => {
    const list = [a, b];
    const out = applyPinUpdate(list, msg("zzz", null, { pinned: false }));
    expect(out.map((m) => m.id)).toEqual(["a", "b"]);
  });
});
