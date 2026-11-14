import { describe, it, expect } from "vitest";
import { normalizeKlipyItem, fitGif, isKlipyMediaUrl } from "@/lib/messages/gifs";

const v = (name: string, w: number, h: number, size: number) => ({ url: `https://static.klipy.com/ii/x/${name}`, width: w, height: h, size });
const item = {
  id: 55, slug: "saturday-wolf", title: "Saturday Wolf", type: "gif",
  file: {
    hd: { gif: v("hd.gif", 498, 278, 3_028_350), webp: v("hd.webp", 498, 279, 306_586), jpg: v("hd.jpg", 498, 278, 20_044) },
    md: { gif: v("md.gif", 640, 358, 3_246_577), webp: v("md.webp", 640, 358, 758_126), jpg: v("md.jpg", 640, 358, 29_615) },
    sm: { gif: v("sm.gif", 220, 123, 400_000), webp: v("sm.webp", 220, 123, 60_000) },
    xs: { webp: v("xs.webp", 90, 50, 9_000) },
  },
};

describe("normalizeKlipyItem", () => {
  it("picks a small animated preview for the picker and a sharp one for chat, both WebP", () => {
    expect(normalizeKlipyItem(item)).toEqual({
      id: "55", title: "Saturday Wolf",
      preview: { url: "https://static.klipy.com/ii/x/sm.webp", width: 220, height: 123 },
      full: { url: "https://static.klipy.com/ii/x/md.webp", width: 640, height: 358 },
    });
  });
  it("uses KLIPY's URLs exactly as given, query strings included", () => {
    const tracked = { id: 1, title: "t", file: { md: { webp: { url: "https://static.klipy.com/a/b.webp?k=1&t=x", width: 10, height: 10, size: 99_000_000 } } } };
    expect(normalizeKlipyItem(tracked)?.full.url).toBe("https://static.klipy.com/a/b.webp?k=1&t=x");
  });
  it("falls back to whatever file exists rather than dropping the result", () => {
    const onlyJpg = { id: 2, title: "x", file: { hd: { jpg: v("hd.jpg", 498, 278, 20_000) } } };
    expect(normalizeKlipyItem(onlyJpg)?.preview.url).toBe("https://static.klipy.com/ii/x/hd.jpg");
    expect(normalizeKlipyItem({ id: 3, title: "x", file: {} })).toBeNull();
  });
});

describe("isKlipyMediaUrl / fitGif", () => {
  it("accepts KLIPY's media hosts only", () => {
    expect(isKlipyMediaUrl("https://static.klipy.com/ii/x/md.webp?k=1")).toBe(true);
    expect(isKlipyMediaUrl("https://media.klipy.com/a.gif")).toBe(true);
    expect(isKlipyMediaUrl("https://klipy.com.evil.net/a.gif")).toBe(false);
    expect(isKlipyMediaUrl("http://static.klipy.com/a.gif")).toBe(false);
  });
  it("scales to fit a box, never up", () => {
    expect(fitGif(640, 358, 300, 300)).toEqual({ width: 300, height: 168 });
    expect(fitGif(220, 400, 300, 300)).toEqual({ width: 165, height: 300 });
    expect(fitGif(100, 50, 300, 300)).toEqual({ width: 100, height: 50 });
  });
});
