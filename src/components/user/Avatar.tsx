"use client";

import { useState } from "react";
import { avatarColor, initials } from "@/lib/avatarColor";

const SIZES = { sm: "w-6 h-6", md: "w-10 h-10", lg: "w-[72px] h-[72px]", xl: "w-[96px] h-[96px]" } as const;
const INITIALS_TEXT = { sm: "text-micro", md: "text-meta", lg: "text-title", xl: "text-display" } as const;
const DOT_SIZE = { sm: "w-2 h-2", md: "w-2.5 h-2.5", lg: "w-3.5 h-3.5", xl: "w-4 h-4" } as const;

export function Avatar({
  url,
  name,
  size = "md",
  seed,
  presence,
  presenceRing = "ring-sidebar",
}: {
  url: string | null;
  name?: string;
  size?: keyof typeof SIZES;
  /** Stable identity (typically the user id) used to pick the avatar colour. Falls back to `name`. */
  seed?: string;
  /** When present, renders a decorative online/offline dot. Omit to render no dot (current behaviour). */
  presence?: "online" | "offline";
  /** Ring colour class for the presence dot's cutout, matching the caller's background. Defaults to the sidebar surface. */
  presenceRing?: string;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = !!url && !failed;
  const { bg, fg } = avatarColor(seed ?? name ?? "");
  return (
    <div className={`${SIZES[size]} relative flex-none`}>
      <div
        className={`${SIZES[size]} rounded-pill flex items-center justify-center overflow-hidden`}
        style={showImage ? undefined : { backgroundColor: bg, color: fg }}
      >
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url!}
            alt={name ?? "avatar"}
            className="w-full h-full object-cover"
            onError={() => setFailed(true)}
          />
        ) : (
          <span className={`${INITIALS_TEXT[size]} font-semibold leading-none select-none`}>
            {initials(name)}
          </span>
        )}
      </div>
      {presence && (
        <span
          aria-hidden="true"
          className={`${DOT_SIZE[size]} absolute bottom-0 right-0 rounded-pill ring-2 ${presenceRing} ${
            presence === "online" ? "bg-online" : "bg-muted"
          }`}
        />
      )}
    </div>
  );
}
