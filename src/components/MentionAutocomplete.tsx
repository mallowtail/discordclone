"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/types/db";

// Shows username matches for `query`; calls onPick with the chosen username.
// Renders nothing when query is null or there are no matches.
export function MentionAutocomplete({
  query,
  onPick,
}: {
  query: string | null;
  onPick: (username: string) => void;
}) {
  const supabase = createClient();
  const [results, setResults] = useState<Profile[]>([]);

  useEffect(() => {
    if (query === null) {
      setResults([]);
      return;
    }
    let active = true;
    supabase
      .from("profiles")
      .select("*")
      .ilike("username", `${query}%`)
      .limit(6)
      .then(({ data }) => {
        if (active) setResults((data as Profile[]) ?? []);
      });
    return () => {
      active = false;
    };
  }, [supabase, query]);

  if (query === null || results.length === 0) return null;

  return (
    <div className="absolute bottom-14 left-3 w-56 bg-[#111214] border border-white/10 rounded-md p-1 shadow-xl z-50">
      {results.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onPick(p.username)}
          className="w-full text-left px-2 py-1 rounded hover:bg-[#404249] text-[#dbdee1] text-sm"
        >
          {p.display_name} <span className="text-[#949ba4]">@{p.username}</span>
        </button>
      ))}
    </div>
  );
}
