"use client";

import type { ReactionPill } from "@/lib/reactions";

export function ReactionBar({
  pills,
  onReact,
}: {
  pills: ReactionPill[];
  onReact: (emoji: string) => void;
}) {
  if (pills.length === 0) return null;
  return (
    <div className="flex items-center flex-wrap gap-1 mt-1">
      {pills.map((p) => (
        <button
          key={p.emoji}
          onClick={() => onReact(p.emoji)}
          title={p.mine ? "Remove your reaction" : `React ${p.emoji}`}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 leading-none transition ${
            p.mine
              ? "border-accent bg-accent/15 hover:bg-accent/25"
              : "border-line bg-surface-2 hover:border-white/20 hover:bg-surface"
          }`}
        >
          <span className="text-sm">{p.emoji}</span>
          <span className={`text-xs font-semibold tabular-nums ${p.mine ? "text-accent" : "text-muted"}`}>
            {p.count}
          </span>
        </button>
      ))}
    </div>
  );
}
