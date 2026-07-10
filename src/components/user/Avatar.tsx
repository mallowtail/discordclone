"use client";

import { useState } from "react";

const SIZES = { sm: "w-6 h-6", md: "w-10 h-10", lg: "w-[72px] h-[72px]" } as const;

export function Avatar({
  url,
  name,
  size = "md",
}: {
  url: string | null;
  name?: string;
  size?: keyof typeof SIZES;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = !!url && !failed;
  return (
    <div
      className={`${SIZES[size]} rounded-full bg-surface flex items-center justify-center overflow-hidden flex-none text-muted`}
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
        <svg viewBox="0 0 24 24" className="w-3/5 h-3/5" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-4.4 0-8 2.7-8 6v1h16v-1c0-3.3-3.6-6-8-6z"
          />
        </svg>
      )}
    </div>
  );
}
