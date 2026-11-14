import { describe, it, expect } from "vitest";
import { normalizeKlipyItem, gifRelayUrl, fitGif } from "@/lib/gifs";

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
  it("skips files too big for the relay, and falls back to a still image", () => {
    const big = { ...item, file: { md: { webp: v("md.webp", 640, 358, 5_000_000), jpg: v("md.jpg", 640, 358, 30_000) } } };
    const n = normalizeKlipyItem(big)!;
    expect(n.full.url).toBe("https://static.klipy.com/ii/x/md.jpg");
    expect(n.preview.url).toBe("https://static.klipy.com/ii/x/md.jpg");
  });
  it("rejects items with nothing usable or from other hosts", () => {
    expect(normalizeKlipyItem({ id: 1, title: "x", file: {} })).toBeNull();
    expect(normalizeKlipyItem({ id: 1, title: "x", file: { md: { webp: { url: "https://evil.example/a.webp", width: 1, height: 1, size: 1 } } } })).toBeNull();
  });
});

describe("gifRelayUrl / fitGif", () => {
  it("routes KLIPY media through our relay", () => {
    expect(gifRelayUrl("https://static.klipy.com/ii/x/md.webp")).toBe("/api/link-preview/image?src=https%3A%2F%2Fstatic.klipy.com%2Fii%2Fx%2Fmd.webp");
  });
  it("scales to fit a box, never up", () => {
    expect(fitGif(640, 358, 300, 300)).toEqual({ width: 300, height: 168 });
    expect(fitGif(220, 400, 300, 300)).toEqual({ width: 165, height: 300 });
    expect(fitGif(100, 50, 300, 300)).toEqual({ width: 100, height: 50 });
  });
});
