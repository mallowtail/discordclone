// Pure decisions for preparing an image before upload. The browser-only canvas work lives in
// imageOptimize.ts; keeping the rules here makes them testable without a DOM.

/** Longest side for images posted in chat. */
export const ATTACHMENT_MAX_DIM = 2048;
/** Longest side for avatars and server icons, which are only ever shown small. */
export const ICON_MAX_DIM = 512;
/** PNG/WebP files above this are re-encoded even when their dimensions are fine (big screenshots). */
export const REENCODE_ABOVE_BYTES = 1.5 * 1024 * 1024;

export type ImagePlan = { action: "keep" } | { action: "encode"; width: number; height: number };

export function planImage(
  src: { type: string; size: number; width: number; height: number },
  maxDim: number
): ImagePlan {
  // Re-saving a GIF through a canvas keeps only the first frame.
  if (src.type === "image/gif") return { action: "keep" };

  const scale = Math.min(1, maxDim / Math.max(src.width, src.height));
  const width = Math.max(1, Math.round(src.width * scale));
  const height = Math.max(1, Math.round(src.height * scale));

  // JPEGs (phone photos) are always re-encoded: that's what strips EXIF, including GPS location.
  if (src.type === "image/jpeg") return { action: "encode", width, height };
  if (scale < 1 || src.size > REENCODE_ABOVE_BYTES) return { action: "encode", width, height };
  return { action: "keep" };
}

/** Whether to upload the re-encoded file instead of the original. */
export function shouldUseEncoded(r: { srcType: string; srcSize: number; outSize: number }): boolean {
  // For JPEGs the point is stripping location data, so a few extra bytes are worth it.
  if (r.srcType === "image/jpeg") return true;
  return r.outSize < r.srcSize;
}

const EXT: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
};

/** `IMG_2041.JPG` + image/webp → `IMG_2041.webp`. */
export function renameForType(name: string, mime: string): string {
  const ext = EXT[mime] ?? "bin";
  const dot = name.lastIndexOf(".");
  return `${dot > 0 ? name.slice(0, dot) : name}.${ext}`;
}

/** File extension for an image MIME type. */
export function extensionForType(mime: string): string {
  return EXT[mime] ?? "bin";
}
