"use client";

import { useState } from "react";
import { serverInitials, colorFromName } from "@/lib/server-icon";

const SIZES = { md: "w-11 h-11 text-body rounded-card", lg: "w-14 h-14 text-lg rounded-card" } as const;

export function ServerIcon({
  iconUrl,
  name,
  size = "md",
}: {
  iconUrl: string | null;
  name: string;
  size?: keyof typeof SIZES;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = !!iconUrl && !failed;
  if (showImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={iconUrl!}
        alt={name}
        onError={() => setFailed(true)}
        className={`${SIZES[size]} object-cover flex-none`}
      />
    );
  }
  return (
    <div
      className={`${SIZES[size]} flex items-center justify-center font-bold text-white flex-none`}
      style={{ background: colorFromName(name) }}
    >
      {serverInitials(name)}
    </div>
  );
}
