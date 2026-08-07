"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import type { Profile } from "@/types/db";
import { Avatar } from "@/components/user/Avatar";
import { openDmWith } from "@/lib/dm";
import { Plus } from "@phosphor-icons/react";

export function NewDmDialog() {
  const supabase = createClient();
  const router = useRouter();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Profile[]>([]);

  async function search(q: string) {
    if (q.length < 2) return setResults([]);
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .ilike("username", `%${q}%`)
      .neq("id", user!.id)
      .limit(10);
    setResults((data as Profile[]) ?? []);
  }

  async function startDm(other: Profile) {
    const convId = await openDmWith(supabase, user!.id, other.id);
    if (!convId) return;
    setOpen(false);
    router.push(`/dms/${convId}`);
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="text-muted hover:text-ink" title="New DM">
        <Plus size={18} weight="bold" />
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
             onClick={() => setOpen(false)}>
          <div className="bg-surface p-4 rounded-2xl w-80 border border-line" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[15px] font-semibold text-ink tracking-tight mb-4">Start a DM</h2>
            <input autoFocus placeholder="Search username…"
              className="w-full p-2 rounded-xl bg-surface-2 text-ink"
              onChange={(e) => search(e.target.value)} />
            <ul className="mt-2 max-h-60 overflow-y-auto">
              {results.map((p) => (
                <li key={p.id}>
                  <button onClick={() => startDm(p)}
                    className="w-full text-left px-2 py-1 rounded hover:bg-surface text-ink flex items-center gap-2">
                    <Avatar url={p.avatar_url ?? null} name={p.display_name} size="sm" />
                    <span className="truncate">{p.display_name} <span className="text-muted">@{p.username}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
