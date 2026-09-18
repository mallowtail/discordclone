import { describe, it, expect } from "vitest";
import { unreadCount, hasUnread } from "@/lib/unread";
import type { Message } from "@/types/db";

function msg(id: string, author_id: string, created_at: string): Message {
  return {
    id,
    author_id,
    channel_id: "c1",
    conversation_id: null,
    content: "hi",
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
  };
}

const ME = "me";
const OTHER = "other";

describe("unreadCount", () => {
  it("a never-read channel (lastReadAt null/undefined) counts every message not authored by me", () => {
    const messages = [
      msg("1", OTHER, "2026-06-05T10:00:00Z"),
      msg("2", OTHER, "2026-06-05T10:01:00Z"),
      msg("3", ME, "2026-06-05T10:02:00Z"),
    ];
    expect(unreadCount(messages, null, ME)).toBe(2);
    expect(unreadCount(messages, undefined, ME)).toBe(2);
  });

  it("a fully-read channel (lastReadAt after every message) counts zero", () => {
    const messages = [
      msg("1", OTHER, "2026-06-05T10:00:00Z"),
      msg("2", OTHER, "2026-06-05T10:01:00Z"),
    ];
    expect(unreadCount(messages, "2026-06-05T10:05:00Z", ME)).toBe(0);
  });

  it("a partially-read channel counts only messages newer than lastReadAt", () => {
    const messages = [
      msg("1", OTHER, "2026-06-05T10:00:00Z"),
      msg("2", OTHER, "2026-06-05T10:01:00Z"),
      msg("3", OTHER, "2026-06-05T10:02:00Z"),
    ];
    expect(unreadCount(messages, "2026-06-05T10:01:30Z", ME)).toBe(1);
  });

  it("never counts messages authored by me, even when unread", () => {
    const messages = [
      msg("1", ME, "2026-06-05T10:00:00Z"),
      msg("2", ME, "2026-06-05T10:01:00Z"),
    ];
    expect(unreadCount(messages, null, ME)).toBe(0);
  });

  it("returns zero for an empty message list", () => {
    expect(unreadCount([], null, ME)).toBe(0);
    expect(unreadCount([], "2026-06-05T10:00:00Z", ME)).toBe(0);
  });

  it("treats a message exactly at lastReadAt as read, not unread", () => {
    const messages = [msg("1", OTHER, "2026-06-05T10:00:00Z")];
    expect(unreadCount(messages, "2026-06-05T10:00:00Z", ME)).toBe(0);
  });
});

describe("hasUnread", () => {
  it("is true when unreadCount would be greater than zero", () => {
    const messages = [msg("1", OTHER, "2026-06-05T10:00:00Z")];
    expect(hasUnread(messages, null, ME)).toBe(true);
  });

  it("is false when unreadCount would be zero", () => {
    const messages = [msg("1", ME, "2026-06-05T10:00:00Z")];
    expect(hasUnread(messages, null, ME)).toBe(false);
  });

  it("is false for an empty message list", () => {
    expect(hasUnread([], null, ME)).toBe(false);
  });
});
