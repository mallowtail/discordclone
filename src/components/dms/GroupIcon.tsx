import { UsersThree } from "@phosphor-icons/react";

const SIZES = { sm: "w-6 h-6", md: "w-10 h-10" } as const;
const ICON = { sm: 14, md: 22 } as const;

/** Stand-in avatar for a group chat (groups don't have pictures). */
export function GroupIcon({ size = "sm" }: { size?: keyof typeof SIZES }) {
  return (
    <span className={`${SIZES[size]} flex-none rounded-pill bg-accent/25 text-accent flex items-center justify-center`} aria-hidden="true">
      <UsersThree size={ICON[size]} weight="bold" />
    </span>
  );
}
