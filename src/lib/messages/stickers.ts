// Server stickers: small PNG/GIF/WebP images a server's admins upload and anyone can send.

import { fitGif } from "@/lib/messages/gifs";

export const STICKER_MAX_BYTES = 524288; // 512 KB
export const STICKER_TYPES = ["image/png", "image/gif", "image/webp"] as const;
export const MAX_STICKERS = 30;
/** Longest side, in px, a sticker is shown at in a message. */
export const STICKER_DISPLAY = 160;
/** Longest side, in px, a static sticker is re-encoded down to on upload. */
export const STICKER_STATIC_MAX = 320;

/** A row of the stickers table. */
export type Sticker = {
  id: string;
  server_id: string;
  name: string;
  path: string;
  width: number;
  height: number;
  created_by: string | null;
  created_at: string;
};

/** What a sticker message stores (messages.sticker); `removed` once the sticker is deleted. */
export type MessageSticker = {
  id: string;
  name: string;
  url?: string;
  width?: number;
  height?: number;
  removed?: boolean;
};

export const stickerPreview = "Sticker";

const PUBLIC_PREFIX = "https://dpsikhsxdwigeuyonfch.supabase.co/storage/v1/object/public/stickers/";

export function checkStickerFile(f: { type: string; size: number }): string | null {
  if (!(STICKER_TYPES as readonly string[]).includes(f.type)) return "Stickers must be PNG, GIF or WebP";
  if (f.size > STICKER_MAX_BYTES) return "Stickers must be 512 KB or smaller";
  return null;
}

export function cleanStickerName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  if (/[\u0000-\u001f\u007f-\u009f]/.test(raw)) return { ok: false, error: "Sticker names can't contain control characters" };
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 30) return { ok: false, error: "Sticker names must be 2–30 characters" };
  return { ok: true, name };
}

export function defaultStickerName(fileName: string): string {
  const base = fileName.replace(/\.[^.]*$/, "").replace(/[_-]/g, " ");
  const spaced = base.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim().replace(/\s+/g, " ").slice(0, 30).trim();
  return cleanStickerName(spaced).ok ? spaced : "sticker";
}

export function stickerExt(type: string): "png" | "gif" | "webp" | null {
  if (type === "image/png") return "png";
  if (type === "image/gif") return "gif";
  if (type === "image/webp") return "webp";
  return null;
}

export function stickerPublicUrl(path: string): string {
  return PUBLIC_PREFIX + path;
}

export function isStickerUrl(url: string): boolean {
  return url.startsWith(PUBLIC_PREFIX);
}

/** Scale down to at most STICKER_DISPLAY on the longer side, keeping the shape; never upscales. */
export function fitSticker(width: number, height: number): { width: number; height: number } {
  return fitGif(width, height, STICKER_DISPLAY, STICKER_DISPLAY);
}

function indexOfAscii(bytes: Uint8Array, word: string): number {
  const n = word.length;
  outer: for (let i = 0; i + n <= bytes.length; i++) {
    for (let j = 0; j < n; j++) if (bytes[i + j] !== word.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
}

/** Does this image animate? GIF always; WebP has an ANIM chunk; PNG (APNG) has acTL before IDAT. */
export function isAnimatedImage(bytes: Uint8Array, type: string): boolean {
  if (type === "image/gif") return true;
  if (type === "image/webp") return indexOfAscii(bytes, "ANIM") >= 0;
  if (type === "image/png") {
    const actl = indexOfAscii(bytes, "acTL");
    if (actl < 0) return false;
    const idat = indexOfAscii(bytes, "IDAT");
    return idat < 0 || actl < idat;
  }
  return false;
}

/** Stickers per server, servers in the given order, filtered by name; empty groups dropped. */
export function groupStickersByServer<S extends { id: string; name: string }>(
  stickers: Sticker[], servers: S[], query: string,
): { server: S; stickers: Sticker[] }[] {
  const q = query.trim().toLowerCase();
  return servers
    .map((server) => ({
      server,
      stickers: stickers
        .filter((s) => s.server_id === server.id && s.name.toLowerCase().includes(q))
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    }))
    .filter((g) => g.stickers.length > 0);
}
