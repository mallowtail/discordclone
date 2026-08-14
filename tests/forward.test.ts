import { describe, it, expect } from "vitest";
import { buildForwardSnapshot } from "@/lib/forward";
import type { Message } from "@/types/db";

function msg(over: Partial<Message> = {}): Message {
  return {
    id: "m1", author_id: "u1", channel_id: "c1", conversation_id: null,
    content: "hello", image_url: null, file_url: null, file_name: null,
    created_at: "t", updated_at: null, reply_to_id: null, mention_author: false,
    pinned: false, pinned_at: null, forward_snapshot: null, ...over,
  };
}

describe("buildForwardSnapshot", () => {
  it("freezes author, content, attachments, and the given source label", () => {
    const s = buildForwardSnapshot(
      msg({ author_id: "u9", content: "hi", image_url: "http://x/y.png", file_url: "http://x/f.pdf", file_name: "f.pdf" }),
      "#general",
    );
    expect(s).toEqual({
      author_id: "u9", content: "hi", image_url: "http://x/y.png",
      file_url: "http://x/f.pdf", file_name: "f.pdf", source: "#general",
    });
  });
  it("coerces null/empty content to an empty string", () => {
    const s = buildForwardSnapshot(msg({ content: "" as unknown as string }), "a direct message");
    expect(s.content).toBe("");
    expect(s.source).toBe("a direct message");
  });
  it("snapshots the outer message's own fields when forwarding a forward (no nesting)", () => {
    const inner: ForwardSnapshotShape = { author_id: "u1", content: "orig", image_url: null, file_url: null, file_name: null, source: "#old" };
    const s = buildForwardSnapshot(msg({ author_id: "u2", content: "outer", forward_snapshot: inner }), "#new");
    expect(s.author_id).toBe("u2");
    expect(s.content).toBe("outer");
    expect(s.source).toBe("#new");
  });
});

type ForwardSnapshotShape = Message["forward_snapshot"];
