"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Message, Profile } from "@/types/db";

function snippet(m: Message): string {
  if (m.content) return m.content.length > 80 ? m.content.slice(0, 80) + "…" : m.content;
  if (m.image_url) return "📷 image";
  return "";
}

export function PinnedPanel({ pinned, onClose }: { pinned: Message[]; onClose: () => void }) {
  const supabase = createClient();
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    const ids = [...new Set(pinned.map((m) => m.author_id))];
    if (ids.length === 0) return;
    supabase.from("profiles").select("*").in("id", ids).then(({ data }) => {
      const next: Record<string, string> = {};
      (data as Profile[] | null)?.forEach((p) => (next[p.id] = p.display_name));
      setNames(next);
    });
  }, [supabase, pinned]);

  function jump(id: string) {
    document.getElementById(`msg-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    onClose();
  }

  async function unpin(id: string) {
    await supabase.rpc("toggle_pin", { msg: id });
  }

  return (
    <div className="absolute right-3 top-12 w-72 bg-[#111214] border border-white/10 rounded-lg p-2 shadow-xl z-50">
      <div className="text-white font-bold text-[11px] uppercase mb-2">📌 Pinned Messages</div>
      {pinned.length === 0 && <div className="text-[#949ba4] text-sm px-1 py-2">No pinned messages yet.</div>}
      {[...pinned]
        .sort((a, b) => (b.pinned_at ?? "").localeCompare(a.pinned_at ?? ""))
        .map((m) => (
          <div key={m.id} className="bg-[#2b2d31] rounded-md p-2 text-xs mb-1.5">
            <button onClick={() => unpin(m.id)} title="Unpin" className="float-right text-[#949ba4] hover:text-white">
              ✕
            </button>
            <div className="text-white font-semibold cursor-pointer" onClick={() => jump(m.id)}>
              {names[m.author_id] ?? "…"}
            </div>
            <div className="text-[#dbdee1] cursor-pointer" onClick={() => jump(m.id)}>
              {snippet(m)}
            </div>
          </div>
        ))}
    </div>
  );
}
