"use client";

import { useState } from "react";
import { Star } from "@phosphor-icons/react";
import { useFavoriteGifs } from "@/components/providers/FavoriteGifsProvider";
import type { MessageGif } from "@/lib/messages/gifs";

/**
 * The star in a GIF's top-right corner (picker and chat). Shown on hover or keyboard focus of the
 * surrounding `group` (always shown on touch screens, which can't hover); filled and gold when
 * favourited.
 */
export function GifFavoriteStar({ gif }: { gif: MessageGif }) {
  const { isFavorite, toggle } = useFavoriteGifs();
  const [error, setError] = useState<string | null>(null);
  const on = isFavorite(gif.url);

  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation(); // in the picker, the GIF itself is a "send" button
        e.preventDefault();
        setError(await toggle(gif));
      }}
      aria-pressed={on}
      aria-label={on ? "Remove from favorite GIFs" : "Add to favorite GIFs"}
      title={error ?? (on ? "Remove from favorites" : "Add to favorites")}
      className={`absolute top-1 right-1 z-10 flex h-8 w-8 items-center justify-center rounded-pill bg-black/60 hover:bg-black/80 focus-visible:opacity-100 ${
        on ? "text-amber" : "text-white"
      } [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100`}
    >
      <Star size={18} weight={on ? "fill" : "bold"} aria-hidden="true" />
    </button>
  );
}
