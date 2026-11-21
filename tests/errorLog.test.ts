import { describe, it, expect } from "vitest";
import { browserName, clearErrorsFailedText, clearedText, errorKindLabel, groupErrors, timesText, type ClientErrorRow } from "@/lib/admin/errorLog";

const CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const SAFARI_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

function row(over: Partial<ClientErrorRow> = {}): ClientErrorRow {
  return {
    id: 1, message: "TypeError: x is undefined", stack: null, path: "/channels/a", user_agent: CHROME_WIN, kind: "error",
    count: 1, first_seen: "2026-11-22T10:00:00Z", last_seen: "2026-11-22T10:00:00Z", user: null, ...over,
  };
}

describe("groupErrors", () => {
  it("groups by message, sums counts, collects paths/browsers/users, newest group first", () => {
    const groups = groupErrors([
      row({ id: 1, count: 3, path: "/channels/a", first_seen: "2026-11-22T08:00:00Z", last_seen: "2026-11-22T09:00:00Z", user: { username: "ann" } }),
      row({ id: 2, count: 1, path: "/dms", user_agent: SAFARI_IPHONE, last_seen: "2026-11-22T11:00:00Z", stack: "latest stack" }),
      row({ id: 3, count: 2, path: "/channels/a", last_seen: "2026-11-22T10:30:00Z", user: { username: "ann" } }),
      row({ id: 4, message: "Other", last_seen: "2026-11-22T12:00:00Z", user: { username: "bo" } }),
    ]);
    expect(groups.map((g) => g.message)).toEqual(["Other", "TypeError: x is undefined"]);
    const g = groups[1];
    expect(g.total).toBe(6);
    expect(g.lastSeen).toBe("2026-11-22T11:00:00Z");
    expect(g.firstSeen).toBe("2026-11-22T08:00:00Z");
    expect(g.paths).toEqual([{ path: "/channels/a", count: 5 }, { path: "/dms", count: 1 }]);
    expect(g.browsers).toEqual(["Safari 17 on iPhone", "Chrome 131 on Windows"]);
    expect(g.users).toEqual(["ann"]);
    expect(g.anonymous).toBe(true);
    expect(g.latest.stack).toBe("latest stack");
    expect(groups[0].anonymous).toBe(false);
  });
  it("handles no rows", () => {
    expect(groupErrors([])).toEqual([]);
  });
});

describe("browserName", () => {
  it("names common browsers and systems", () => {
    expect(browserName(CHROME_WIN)).toBe("Chrome 131 on Windows");
    expect(browserName(SAFARI_IPHONE)).toBe("Safari 17 on iPhone");
    expect(browserName("Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:132.0) Gecko/20100101 Firefox/132.0")).toBe("Firefox 132 on Mac");
    expect(browserName("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0.2903")).toBe("Edge 131 on Windows");
    expect(browserName("Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36")).toBe("Samsung Internet 25 on Android");
    expect(browserName("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1")).toBe("Chrome 131 on iPhone");
  });
  it("falls back", () => {
    expect(browserName(null)).toBe("Unknown browser");
    expect(browserName("curl/8.0")).toBe("Unknown browser");
  });
});

describe("labels", () => {
  it("words", () => {
    expect(errorKindLabel("boundary")).toBe("Page crashed");
    expect(errorKindLabel("rejection")).toBe("Unhandled promise");
    expect(errorKindLabel("error")).toBe("Uncaught error");
    expect(timesText(1)).toBe("1 time");
    expect(timesText(1200)).toBe("1,200 times");
    expect(clearedText(0)).toBe("Nothing to clear.");
    expect(clearedText(1)).toBe("Cleared 1 entry.");
    expect(clearedText(3)).toBe("Cleared 3 entries.");
    expect(clearErrorsFailedText("not permitted")).toBe("Only the Mallowchat admin can do that.");
    expect(clearErrorsFailedText(undefined)).toBe("Couldn't clear the errors — try again.");
  });
});
