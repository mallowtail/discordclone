"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/Modal";

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
    <Modal onClose={onClose} title="Create category" size="sm">
      <div className="p-5">
        {error && <p className="text-danger text-body mb-2">{error}</p>}
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") create(); }}
          placeholder="Category name"
          className="w-full p-2 rounded-control bg-surface-2 text-ink mb-3"
        />
        <button
          onClick={create}
          disabled={busy}
          className="w-full bg-accent hover:bg-accent-strong text-white font-medium rounded-control p-2 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create"}
        </button>
      </div>
    </Modal>
  );
}
