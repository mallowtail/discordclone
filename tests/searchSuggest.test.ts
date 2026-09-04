import { describe, it, expect } from "vitest";
import { activeToken, suggestKind, applySuggestion } from "@/lib/searchSuggest";

describe("activeToken", () => {
  it("finds the token the caret sits inside", () => {
    expect(activeToken("from:al in:x", 7)).toEqual({ token: "from:al", start: 0, end: 7 });
  });
  it("finds a later token by caret position", () => {
    expect(activeToken("from:al in:x", 11)).toEqual({ token: "in:x", start: 8, end: 12 });
  });
  it("empty input yields an empty token", () => {
    expect(activeToken("", 0)).toEqual({ token: "", start: 0, end: 0 });
  });
});

describe("suggestKind", () => {
  it("no colon → operator suggestions", () => {
    expect(suggestKind("fr")).toEqual({ kind: "operator", partial: "fr" });
  });
  it("from:/mentions: strip a leading @", () => {
    expect(suggestKind("from:@al")).toEqual({ kind: "from", partial: "al" });
    expect(suggestKind("mentions:be")).toEqual({ kind: "mentions", partial: "be" });
  });
  it("in: strips a leading #", () => {
    expect(suggestKind("in:#ran")).toEqual({ kind: "in", partial: "ran" });
  });
  it("has/pinned/date classified", () => {
    expect(suggestKind("has:im").kind).toBe("has");
    expect(suggestKind("pinned:").kind).toBe("pinned");
    expect(suggestKind("before:2026").kind).toBe("date");
  });
  it("unknown key → null", () => {
    expect(suggestKind("wat:x").kind).toBeNull();
  });
});

describe("applySuggestion", () => {
  it("replaces the active token and moves the caret to its end", () => {
    expect(applySuggestion("hello fr", 8, "from:")).toEqual({ raw: "hello from:", caret: 11 });
  });
  it("replaces a value token including a trailing space", () => {
    expect(applySuggestion("has:im", 6, "has:image ")).toEqual({ raw: "has:image ", caret: 10 });
  });
});
