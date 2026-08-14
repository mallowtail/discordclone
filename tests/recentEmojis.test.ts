import { describe, it, expect } from "vitest";
import { pushRecent, toolbarRecents } from "@/lib/recentEmojis";

describe("pushRecent", () => {
  it("unshifts a new emoji to the front", () => {
    expect(pushRecent(["😀", "🎉"], "❤️")).toEqual(["❤️", "😀", "🎉"]);
  });
  it("moves an existing emoji to the front without duplicating", () => {
    expect(pushRecent(["😀", "🎉", "❤️"], "🎉")).toEqual(["🎉", "😀", "❤️"]);
  });
  it("caps the list at max, dropping the oldest", () => {
    expect(pushRecent(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });
  it("defaults the cap to 12", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `e${i}`);
    const out = pushRecent(twelve, "new");
    expect(out).toHaveLength(12);
    expect(out[0]).toBe("new");
    expect(out).not.toContain("e11");
  });
});

describe("toolbarRecents", () => {
  it("returns the user's recents first, always length 3", () => {
    expect(toolbarRecents(["🔥", "🚀"])).toEqual(["🔥", "🚀", "👍"]);
  });
  it("pads entirely from the seed when empty", () => {
    expect(toolbarRecents([])).toEqual(["👍", "❤️", "😂"]);
  });
  it("does not duplicate a seed emoji already in recents", () => {
    expect(toolbarRecents(["❤️"])).toEqual(["❤️", "👍", "😂"]);
  });
  it("truncates to 3 when recents already has more", () => {
    expect(toolbarRecents(["🔥", "🚀", "✨", "🎯"])).toEqual(["🔥", "🚀", "✨"]);
  });
});
