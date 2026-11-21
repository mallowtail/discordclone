"use client";

import { useState } from "react";
import type { MessageSticker } from "@/lib/messages/stickers";
import { fitSticker, isStickerUrl } from "@/lib/messages/stickers";

/** A sticker in a message: just the image, no bubble. Shows a small note if it was deleted or can't load. */
export function StickerImage({ sticker, max }: { sticker: MessageSticker; max?: number }) {
  const [failed, setFailed] = useState(false);
  const url = sticker.url;
  if (sticker.removed || !url || !isStickerUrl(url) || failed) {
    return (
      <span className="mt-1 inline-block rounded-control border border-line px-3 py-2 text-meta text-muted">
        Sticker removed
      </span>
    );
  }
  const fit = fitSticker(sticker.width ?? 160, sticker.height ?? 160);
  let { width, height } = fit;
  if (max && Math.max(width, height) > max) {
    const k = max / Math.max(width, height);
    width = Math.max(1, Math.round(width * k));
    height = Math.max(1, Math.round(height * k));
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- user-uploaded Supabase storage content, animated stickers must not be re-encoded
    <img src={url} alt={`Sticker: ${sticker.name}`} title={sticker.name} width={width} height={height}
      loading="lazy" onError={() => setFailed(true)} className="mt-1 block" style={{ width, height }} />
  );
}
