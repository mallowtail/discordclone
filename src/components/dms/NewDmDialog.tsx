"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import type { Profile } from "@/types/db";
import { Avatar } from "@/components/user/Avatar";

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
    // find an existing 1-on-1 conversation with this person, else create one
    const { data: mine } = await supabase
      .from("conversation_members").select("conversation_id").eq("user_id", user!.id);
    const myIds = (mine ?? []).map((m) => m.conversation_id);
    let convId: string | null = null;
    if (myIds.length) {
      const { data: shared } = await supabase
        .from("conversation_members")
        .select("conversation_id")
        .eq("user_id", other.id)
        .in("conversation_id", myIds);
      convId = shared?.[0]?.conversation_id ?? null;
    }
    if (!convId) {
      // Generate the id client-side. We can't read a new conversation back via
      // .select() yet: RLS only lets *members* read a conversation, and we don't
      // become a member until the next insert. So we avoid select-after-insert.
      const newId = crypto.randomUUID();
      const { error: convErr } = await supabase
        .from("conversations").insert({ id: newId, is_group: false });
      if (convErr) return;
      const { error: memErr } = await supabase.from("conversation_members").insert([
        { conversation_id: newId, user_id: user!.id },
        { conversation_id: newId, user_id: other.id },
      ]);
      if (memErr) return;
      convId = newId;
    }
    setOpen(false);
    router.push(`/dms/${convId}`);
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="text-muted hover:text-ink" title="New DM">＋</button>
      {open && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
             onClick={() => setOpen(false)}>
          <div className="bg-surface p-4 rounded-xl w-80 border border-line" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-ink font-semibold mb-2">Start a DM</h2>
            <input autoFocus placeholder="Search username…"
              className="w-full p-2 rounded-lg bg-surface-2 text-ink"
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
