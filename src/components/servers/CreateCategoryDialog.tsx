"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function CreateCategoryDialog({
  serverId,
  position,
  onClose,
}: {
  serverId: string;
  position: number;
  onClose: () => void;
}) {
  const supabase = createClient();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) return setError("Enter a category name");
    setError(null);
    setBusy(true);
    const { error: err } = await supabase
      .from("categories")
      .insert({ server_id: serverId, name: trimmed, position });
    setBusy(false);
    if (err) return setError("Couldn't create — try again");
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface p-5 rounded-2xl w-80 border border-line" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-ink font-semibold mb-3">Create category</h2>
        {error && <p className="text-danger text-sm mb-2">{error}</p>}
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") create(); }}
          placeholder="Category name"
          className="w-full p-2 rounded-xl bg-surface-2 text-ink mb-3"
        />
        <button
          onClick={create}
          disabled={busy}
          className="w-full bg-accent hover:bg-accent-strong text-white font-medium rounded-xl p-2 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create"}
        </button>
      </div>
    </div>
  );
}
