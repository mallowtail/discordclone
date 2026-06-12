import { describe, it, expect } from "vitest";
import { extractMentions, mentionsMe } from "@/lib/mentions";

describe("extractMentions", () => {
  it("finds @usernames", () => {
    expect(extractMentions("hey @sam and @alex_2")).toEqual(["sam", "alex_2"]);
  });
  it("ignores an email-like a@b", () => {
    expect(extractMentions("mail me at me@example")).toEqual([]);
  });
  it("returns empty for no mentions", () => {
    expect(extractMentions("just text")).toEqual([]);
  });
});

describe("mentionsMe", () => {
  const base = {
    content: "",
    myUsername: "sam",
    myId: "me",
    replyToId: null as string | null,
    mentionAuthor: false,
    repliedToAuthorId: null as string | null,
  };
  it("true when my username is mentioned (case-insensitive)", () => {
    expect(mentionsMe({ ...base, content: "yo @Sam" })).toBe(true);
  });
  it("true for a ping-reply to my own message", () => {
    expect(mentionsMe({ ...base, replyToId: "m1", mentionAuthor: true, repliedToAuthorId: "me" })).toBe(true);
  });
  it("false for a ping-reply to someone else's message", () => {
    expect(mentionsMe({ ...base, replyToId: "m1", mentionAuthor: true, repliedToAuthorId: "other" })).toBe(false);
  });
  it("false when the reply ping is off", () => {
    expect(mentionsMe({ ...base, replyToId: "m1", mentionAuthor: false, repliedToAuthorId: "me" })).toBe(false);
  });
  it("false when nothing matches", () => {
    expect(mentionsMe({ ...base, content: "hi @alex" })).toBe(false);
  });
});
