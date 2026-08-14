"use client";

import { useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import type { Message } from "@/types/db";
import type { ReactionPill } from "@/lib/reactions";

const EMOJI = ["👍", "❤️", "😂", "🎉", "😮", "😢"];

export function ReactionBar({ message, pills }: { message: Message; pills: ReactionPill[] }) {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();

  async function toggle(emoji: string, mine: boolean) {
    if (!user) return;
    if (mine) {
      await supabase
        .from("reactions")
        .delete()
        .eq("message_id", message.id)
        .eq("user_id", user.id)
        .eq("emoji", emoji);
    } else {
      await supabase
        .from("reactions")
        .insert({ message_id: message.id, user_id: user.id, emoji });
    }
  }

  return (
    <div className="flex items-center flex-wrap gap-1 mt-1">
      {pills.map((p) => (
        <button
          key={p.emoji}
          onClick={() => toggle(p.emoji, p.mine)}
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
      <div className="hidden group-hover:flex items-center gap-0.5 rounded-full border border-line bg-surface-2 px-1 py-0.5 shadow-sm">
        {EMOJI.map((e) => (
          <button
            key={e}
            title={`React ${e}`}
            onClick={() => toggle(e, pills.find((p) => p.emoji === e)?.mine ?? false)}
            className="w-7 h-7 flex items-center justify-center rounded-full text-base opacity-80 hover:opacity-100 hover:bg-surface hover:scale-110 transition"
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
