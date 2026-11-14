// GIFs from KLIPY. Per KLIPY's integration requirements the browser calls their API itself, loads
// media straight from the URLs they return (unchanged), and shows results in their order without
// dropping any — so nothing here filters, caches, rewrites or relays.

export type GifFile = { url: string; width: number; height: number };
export type Gif = { id: string; title: string; preview: GifFile; full: GifFile };
/** What a GIF message stores (messages.gif). */
export type MessageGif = GifFile & { title: string };

/** KLIPY's media hosts (static.klipy.com and other *.klipy.com), https only. */
export function isKlipyMediaUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "klipy.com" || u.hostname.endsWith(".klipy.com"));
  } catch {
    return false;
  }
}

type KlipyVariant = { url?: string; width?: number; height?: number; size?: number };
type KlipyItem = { id: number | string; title?: string; file?: Record<string, Record<string, KlipyVariant> | undefined> };

function pick(file: KlipyItem["file"], order: [string, string][]): GifFile | null {
  for (const [size, format] of order) {
    const v = file?.[size]?.[format];
    if (v?.url && v.width && v.height) return { url: v.url, width: v.width, height: v.height };
  }
  return null;
}

// Animated WebP is far smaller than GIF; a still JPG is the last resort. Every combination is
// listed so a result always has something to show (results must not be dropped).
const SIZES = ["sm", "xs", "md", "hd"];
const FORMATS = ["webp", "gif", "jpg"];
const PREVIEW_ORDER: [string, string][] = FORMATS.flatMap((f) => SIZES.map((s): [string, string] => [s, f]));
const FULL_ORDER: [string, string][] = FORMATS.flatMap((f) => ["md", "hd", "sm", "xs"].map((s): [string, string] => [s, f]));

export function normalizeKlipyItem(item: KlipyItem): Gif | null {
  const preview = pick(item.file, PREVIEW_ORDER);
  const full = pick(item.file, FULL_ORDER);
  if (!preview || !full) return null;
  return { id: String(item.id), title: (item.title ?? "").slice(0, 200), preview, full };
}

/** Scale (w, h) down to fit inside maxW × maxH, keeping the shape; never scales up. */
export function fitGif(w: number, h: number, maxW: number, maxH: number) {
  const scale = Math.min(1, maxW / w, maxH / h);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}
