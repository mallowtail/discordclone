import { describe, it, expect } from "vitest";
import {
  checkStickerFile, cleanStickerName, defaultStickerName, fitSticker, isAnimatedImage,
  isStickerUrl, stickerPublicUrl, groupStickersByServer, type Sticker,
} from "@/lib/messages/stickers";

const enc = (s: string) => new TextEncoder().encode(s);
const UUID = "0b6c1c1e-1111-4222-8333-444455556666";

describe("checkStickerFile", () => {
  it("checks type then size", () => {
    expect(checkStickerFile({ type: "image/jpeg", size: 10 })).toBe("Stickers must be PNG, GIF or WebP");
    expect(checkStickerFile({ type: "image/png", size: 524289 })).toBe("Stickers must be 512 KB or smaller");
    expect(checkStickerFile({ type: "image/webp", size: 524288 })).toBeNull();
  });
});

describe("cleanStickerName", () => {
  it("trims and collapses whitespace", () => {
    expect(cleanStickerName("  hi   there ")).toEqual({ ok: true, name: "hi there" });
  });
  it("rejects bad lengths and control characters", () => {
    expect(cleanStickerName("a").ok).toBe(false);
    expect(cleanStickerName("x".repeat(31)).ok).toBe(false);
    expect(cleanStickerName("bad\u0007").ok).toBe(false);
  });
  it("counts emoji as one character each, like Postgres char_length", () => {
    expect(cleanStickerName("💀").ok).toBe(false);
    expect(cleanStickerName("💀💀")).toEqual({ ok: true, name: "💀💀" });
    expect(cleanStickerName("💀".repeat(30)).ok).toBe(true);
    expect(cleanStickerName("💀".repeat(31)).ok).toBe(false);
  });
});

describe("defaultStickerName", () => {
  it("derives a name from a file name", () => {
    expect(defaultStickerName("sad_cat-2.png")).toBe("sad cat 2");
    expect(defaultStickerName(".png")).toBe("sticker");
    expect(defaultStickerName("x".repeat(50) + ".gif")).toBe("x".repeat(30));
  });
  it("cuts long emoji names by character, never splitting a surrogate pair", () => {
    expect(defaultStickerName("💀".repeat(40) + ".png")).toBe("💀".repeat(30));
    const name = defaultStickerName("a" + "💀".repeat(40) + ".png");
    expect(name).toBe("a" + "💀".repeat(29));
    expect(name).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe("fitSticker", () => {
  it("shrinks to 160 and never upscales", () => {
    expect(fitSticker(320, 160)).toEqual({ width: 160, height: 80 });
    expect(fitSticker(100, 50)).toEqual({ width: 100, height: 50 });
  });
});

describe("sticker urls", () => {
  it("recognises only the stickers bucket", () => {
    expect(isStickerUrl(stickerPublicUrl(`${UUID}/${UUID}.png`))).toBe(true);
    expect(isStickerUrl("https://dpsikhsxdwigeuyonfch.supabase.co/storage/v1/object/public/server-icons/a.png")).toBe(false);
    expect(isStickerUrl("http://dpsikhsxdwigeuyonfch.supabase.co/storage/v1/object/public/stickers/a.png")).toBe(false);
  });
});

describe("isAnimatedImage", () => {
  it("treats GIF as animated", () => expect(isAnimatedImage(enc("GIF89a...."), "image/gif")).toBe(true));
  it("detects APNG by acTL before IDAT", () => {
    expect(isAnimatedImage(enc("\x89PNG\r\n\x1a\n....IHDR....acTL....IDAT...."), "image/png")).toBe(true);
    expect(isAnimatedImage(enc("\x89PNG\r\n\x1a\n....IHDR....IDAT....acTL"), "image/png")).toBe(false);
    expect(isAnimatedImage(enc("\x89PNG\r\n\x1a\n....IHDR....IDAT...."), "image/png")).toBe(false);
  });
  it("detects animated WebP by ANIM", () => {
    expect(isAnimatedImage(enc("RIFF....WEBPVP8X....ANIM...."), "image/webp")).toBe(true);
    expect(isAnimatedImage(enc("RIFF....WEBPVP8X........"), "image/webp")).toBe(false);
  });
  it("is false for other types", () => expect(isAnimatedImage(enc("ANIM acTL"), "image/jpeg")).toBe(false));
});

describe("groupStickersByServer", () => {
  const st = (id: string, server_id: string, name: string, created_at: string): Sticker => ({
    id, server_id, name, path: "p", width: 1, height: 1, created_by: null, created_at,
  });
  const servers = [{ id: "s1", name: "One" }, { id: "s2", name: "Two" }, { id: "s3", name: "Three" }];
  const stickers = [
    st("b", "s2", "sad cat", "2026-01-02"), st("a", "s2", "happy cat", "2026-01-01"),
    st("c", "s1", "dog", "2026-01-01"),
  ];
  it("keeps server order, drops empties, orders by created_at", () => {
    const g = groupStickersByServer(stickers, servers, "");
    expect(g.map((x) => x.server.id)).toEqual(["s1", "s2"]);
    expect(g[1].stickers.map((s) => s.id)).toEqual(["a", "b"]);
  });
  it("matches case-insensitively", () => {
    const g = groupStickersByServer(stickers, servers, "CAT");
    expect(g.map((x) => x.server.id)).toEqual(["s2"]);
    expect(g[0].stickers).toHaveLength(2);
    expect(groupStickersByServer(stickers, servers, "sad")[0].stickers.map((s) => s.id)).toEqual(["b"]);
  });
});
