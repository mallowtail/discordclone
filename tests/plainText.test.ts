import { describe, it, expect } from "vitest";
import { isPlainText } from "@/lib/messages/plainText";

describe("isPlainText (safe to skip the Markdown formatter)", () => {
  it("ordinary chat is plain", () => {
    for (const t of ["hello there", "lol that's so funny", "ok see you at 3", "what time?", "I'm 13 and bored", "message 1 in memes"]) {
      expect(isPlainText(t), t).toBe(true);
    }
  });
  it("anything that could be formatting goes through the formatter", () => {
    for (const t of [
      "**bold**", "_hi_", "~~no~~", "`code`", "[link](https://x.com)", "# heading", "> quote", "- item", "+ item",
      "1. first", "2) second", "hi @sam", "see https://x.com", "a\nb", "a & b", "a < b", "a|b", "\\escaped", "!image", "x: y",
    ]) {
      expect(isPlainText(t), t).toBe(false);
    }
  });
  it("empty is not plain (nothing to show)", () => {
    expect(isPlainText("")).toBe(false);
  });
});
