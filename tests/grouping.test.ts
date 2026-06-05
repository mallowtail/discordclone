import { describe, it, expect } from "vitest";
import { startsNewGroup } from "@/lib/grouping";
import type { Message } from "@/types/db";

function msg(author_id: string, created_at: string): Message {
  return { id: "x", author_id, channel_id: "c", conversation_id: null, content: "hi", created_at };
}

describe("startsNewGroup", () => {
  it("starts a group when there is no previous message", () => {
    expect(startsNewGroup(undefined, msg("alice", "2026-06-05T10:00:00Z"))).toBe(true);
  });
  it("starts a group when the author changes", () => {
    const prev = msg("alice", "2026-06-05T10:00:00Z");
    const curr = msg("bob", "2026-06-05T10:00:05Z");
    expect(startsNewGroup(prev, curr)).toBe(true);
  });
  it("groups consecutive messages from the same author within 7 minutes", () => {
    const prev = msg("alice", "2026-06-05T10:00:00Z");
    const curr = msg("alice", "2026-06-05T10:06:00Z"); // 6 min later
    expect(startsNewGroup(prev, curr)).toBe(false);
  });
  it("starts a new group when the same author pauses longer than 7 minutes", () => {
    const prev = msg("alice", "2026-06-05T10:00:00Z");
    const curr = msg("alice", "2026-06-05T10:08:00Z"); // 8 min later
    expect(startsNewGroup(prev, curr)).toBe(true);
  });
});
