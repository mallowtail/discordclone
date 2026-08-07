"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Dropdown } from "@/components/ui/Dropdown";
import type { Category } from "@/types/db";

export function CreateChannelDialog({
  serverId,
  categories,
  onClose,
}: {
  serverId: string;
  categories: Category[];
  onClose: () => void;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<string>(categories[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const trimmed = name.trim().replace(/\s+/g, "-").toLowerCase();
    if (!trimmed) return setError("Enter a channel name");
    setError(null);
    setBusy(true);
    const { data, error: err } = await supabase
      .from("channels")
      .insert({ name: trimmed, server_id: serverId, category_id: categoryId || null, position: 0 })
      .select("id")
      .single();
    setBusy(false);
    if (err) return setError("Couldn't create — try again");
    onClose();
    router.push(`/channels/${data.id}`);
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface p-5 rounded-2xl w-80 border border-line" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[15px] font-semibold text-ink tracking-tight mb-4">Create channel</h2>
        {error && <p className="text-danger text-sm mb-2">{error}</p>}
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
          placeholder="channel-name" className="w-full p-2 rounded-xl bg-surface-2 text-ink mb-3" />
        {categories.length > 0 && (
          <div className="mb-3">
            <Dropdown
              value={categoryId}
              onChange={setCategoryId}
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>
        )}
        <button onClick={create} disabled={busy}
          className="w-full bg-accent hover:bg-accent-strong text-white font-medium rounded-xl p-2 disabled:opacity-50">
          {busy ? "Creating…" : "Create"}
        </button>
      </div>
    </div>
  );
}
