/** Count of friend requests waiting for you. Uses the `mention` tokens: like an @mention, a request
 *  is aimed at you and wants an answer, unlike the neutral unread dot. Renders nothing at zero. */
export function RequestBadge({ count, className = "" }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={`min-w-5 h-5 px-1.5 flex items-center justify-center rounded-pill bg-mention-ink text-mention text-micro font-bold ${className}`}
      aria-label={`${count} friend request${count === 1 ? "" : "s"}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
