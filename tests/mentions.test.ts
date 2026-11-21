import { describe, it, expect } from "vitest";
import { extractMentions, mentionsMe, remarkMentions } from "@/lib/messages/mentions";

describe("extractMentions", () => {
  it("finds @usernames", () => {
    expect(extractMentions("hey @sam and @alex_2")).toEqual(["sam", "alex_2"]);
  });
  it("ignores an email-like a@b", () => {
    expect(extractMentions("mail me at me@example")).toEqual([]);
  });
  it("finds 1- and 2-letter usernames", () => {
    expect(extractMentions("@a hi @bc")).toEqual(["a", "bc"]);
  });
  it("stops at the first non-username character", () => {
    expect(extractMentions("(@x), @y!")).toEqual(["x", "y"]);
  });
  it("ignores a bare @", () => {
    expect(extractMentions("@ nobody")).toEqual([]);
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
  it("true for a 1-letter username", () => {
    expect(mentionsMe({ ...base, myUsername: "q", content: "hey @Q" })).toBe(true);
    expect(mentionsMe({ ...base, myUsername: "q", content: "hey @qq" })).toBe(false);
  });
  it("false when nothing matches", () => {
    expect(mentionsMe({ ...base, content: "hi @alex" })).toBe(false);
  });
});

describe("remarkMentions", () => {
  it("turns a 1-letter @mention into a mention link", () => {
    const tree = { type: "root", children: [{ type: "paragraph", children: [{ type: "text", value: "hi @a!" }] }] };
    remarkMentions()(tree);
    expect(tree.children[0].children).toEqual([
      { type: "text", value: "hi " },
      { type: "link", url: "mention:a", children: [{ type: "text", value: "@a" }] },
      { type: "text", value: "!" },
    ]);
  });
});
