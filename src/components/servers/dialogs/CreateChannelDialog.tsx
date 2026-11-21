"use client";

import { Hash, SpeakerHigh } from "@phosphor-icons/react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/Modal";

/** Creates a text or voice channel in the given category (null = not in any category). */
export function CreateChannelDialog({
  serverId,
  categoryId,
  onClose,
}: {
  serverId: string;
  categoryId: string | null;
  onClose: () => void;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"text" | "voice">("text");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    // Text channels are "like-this"; voice channel names keep their spaces and capitals, like Discord.
    const trimmed = kind === "text" ? name.trim().replace(/\s+/g, "-").toLowerCase() : name.trim().replace(/\s+/g, " ");
    if (!trimmed) return setError("Enter a channel name");
    setError(null);
    setBusy(true);
    const { data, error: err } = await supabase
      .from("channels")
      .insert({ name: trimmed, server_id: serverId, category_id: categoryId, position: 0, kind })
      .select("id")
      .single();
    setBusy(false);
    if (err) return setError("Couldn't create — try again");
    onClose();
    // Voice channels are joined from the sidebar, not opened as a page.
    if (kind === "text") router.push(`/channels/${data.id}`);
  }

  return (
    <Modal onClose={onClose} title="Create channel" size="sm">
      <div className="p-5">
        {error && <p className="text-danger text-body mb-2">{error}</p>}
        <div className="mb-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Channel type">
          {(["text", "voice"] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
              className={`flex items-center gap-2 rounded-control border px-3 py-2 text-body ${
                kind === k ? "border-accent bg-accent/10 text-ink" : "border-line text-muted hover:text-ink"
              }`}>
              {k === "text" ? <Hash size={16} weight="bold" aria-hidden="true" /> : <SpeakerHigh size={16} weight="bold" aria-hidden="true" />}
              {k === "text" ? "Text" : "Voice"}
            </button>
          ))}
        </div>
        <input autoFocus value={name} maxLength={100} onChange={(e) => setName(e.target.value)}
          placeholder={kind === "text" ? "channel-name" : "Hangout"} aria-label="Channel name"
          className="w-full p-2 rounded-control bg-surface-2 text-ink mb-3" />
        <button onClick={create} disabled={busy}
          className="w-full bg-accent hover:bg-accent-strong text-white font-medium rounded-control p-2 disabled:opacity-50">
          {busy ? "Creating…" : "Create"}
        </button>
      </div>
    </Modal>
  );
}
