// GIFs from KLIPY: picking which file to show, and routing it through our own relay so viewers'
// browsers never contact KLIPY directly.

export type GifFile = { url: string; width: number; height: number };
export type Gif = { id: string; title: string; preview: GifFile; full: GifFile };
/** What a GIF message stores (messages.gif). */
export type MessageGif = GifFile & { title: string };

/** The relay (/api/link-preview/image) refuses anything at or above 3 MB. */
const RELAY_MAX = 2_900_000;
const KLIPY_MEDIA = /^https:\/\/static\.klipy\.com\/[A-Za-z0-9/_-]+\.(webp|gif|jpg)$/;

type KlipyVariant = { url?: string; width?: number; height?: number; size?: number };
type KlipyItem = { id: number | string; title?: string; file?: Record<string, Record<string, KlipyVariant> | undefined> };

function pick(file: KlipyItem["file"], order: [string, string][]): GifFile | null {
  for (const [size, format] of order) {
    const v = file?.[size]?.[format];
    if (v?.url && KLIPY_MEDIA.test(v.url) && v.width && v.height && (v.size ?? 0) < RELAY_MAX) {
      return { url: v.url, width: v.width, height: v.height };
    }
  }
  return null;
}

// Animated WebP is far smaller than GIF; a still JPG is the last resort.
const PREVIEW_ORDER: [string, string][] = [["sm", "webp"], ["xs", "webp"], ["md", "webp"], ["sm", "gif"], ["hd", "webp"], ["sm", "jpg"], ["md", "jpg"], ["hd", "jpg"]];
const FULL_ORDER: [string, string][] = [["md", "webp"], ["hd", "webp"], ["sm", "webp"], ["md", "gif"], ["hd", "gif"], ["md", "jpg"], ["hd", "jpg"]];

export function normalizeKlipyItem(item: KlipyItem): Gif | null {
  const preview = pick(item.file, PREVIEW_ORDER);
  const full = pick(item.file, FULL_ORDER);
  if (!preview || !full) return null;
  return { id: String(item.id), title: (item.title ?? "").slice(0, 200), preview, full };
}

export function gifRelayUrl(url: string): string {
  return `/api/link-preview/image?src=${encodeURIComponent(url)}`;
}

/** Scale (w, h) down to fit inside maxW × maxH, keeping the shape; never scales up. */
export function fitGif(w: number, h: number, maxW: number, maxH: number) {
  const scale = Math.min(1, maxW / w, maxH / h);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}
