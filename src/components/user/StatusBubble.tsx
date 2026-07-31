"use client";

export function StatusBubble({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  return (
    <div className="relative bg-surface-2 text-ink text-sm rounded-xl px-3 py-1.5 max-w-[150px]">
      {/* tail: a small rotated square poking toward the avatar on the left */}
      <span
        className="absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-2 rotate-45 bg-surface-2"
        aria-hidden="true"
      />
      <span className="break-words">{status}</span>
    </div>
  );
}
