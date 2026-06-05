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
    <div className="flex items-center gap-1 mt-0.5">
      {pills.map((p) => (
        <button
          key={p.emoji}
          onClick={() => toggle(p.emoji, p.mine)}
          className={`text-xs rounded px-1.5 py-0.5 border ${
            p.mine ? "border-[#5865f2] bg-[#5865f2]/20" : "border-transparent bg-black/20"
          }`}
        >
          {p.emoji} {p.count}
        </button>
      ))}
      <div className="hidden group-hover:flex gap-0.5 ml-1">
        {EMOJI.map((e) => (
          <button
            key={e}
            title={`React ${e}`}
            onClick={() => toggle(e, pills.find((p) => p.emoji === e)?.mine ?? false)}
            className="text-xs opacity-50 hover:opacity-100"
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
