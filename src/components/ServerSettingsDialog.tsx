"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { uploadServerIcon } from "@/lib/upload";
import { ServerIcon } from "@/components/ServerIcon";
import type { Server } from "@/types/db";

export function ServerSettingsDialog({
  server,
  onSaved,
  onClose,
}: {
  server: Server;
  onSaved: () => void;
  onClose: () => void;
}) {
  const supabase = createClient();
  const router = useRouter();
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(server.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function leave() {
    if (!user) return;
    if (!confirm(`Leave ${server.name}?`)) return;
    await supabase.from("server_members").delete().eq("server_id", server.id).eq("user_id", user.id);
    onClose();
    router.replace("/channels/first");
  }

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed) return setError("Enter a name");
    setBusy(true);
    const { error: err } = await supabase.from("servers").update({ name: trimmed }).eq("id", server.id);
    setBusy(false);
    if (err) return setError("Couldn't save — try again");
    onSaved();
    onClose();
  }

  async function onPickIcon(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setBusy(true);
    const res = await uploadServerIcon(file);
    if ("error" in res) {
      setBusy(false);
      return setError(res.error);
    }
    const { error: err } = await supabase.from("servers").update({ icon_url: res.url }).eq("id", server.id);
    setBusy(false);
    if (err) return setError("Couldn't save icon — try again");
    onSaved();
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface p-5 rounded-xl w-80 border border-line" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-ink font-semibold mb-3">Server settings</h2>
        {error && <p className="text-danger text-sm mb-2">{error}</p>}
        <div className="flex items-center gap-3 mb-3">
          <ServerIcon iconUrl={server.icon_url} name={server.name} size="lg" />
          <button onClick={() => fileRef.current?.click()} disabled={busy}
            className="text-sm bg-accent hover:bg-accent-strong text-white rounded-lg px-3 py-1.5 disabled:opacity-50">
            Upload icon
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickIcon} />
        </div>
        <label className="text-muted text-xs">Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)}
          className="w-full p-2 rounded-lg bg-surface-2 text-ink mt-1 mb-3" />
        <button onClick={saveName} disabled={busy}
          className="w-full bg-accent hover:bg-accent-strong text-white font-medium rounded-lg p-2 disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
        <button onClick={leave} disabled={busy}
          className="w-full text-danger text-sm mt-3 hover:underline disabled:opacity-50">
          Leave server
        </button>
      </div>
    </div>
  );
}
