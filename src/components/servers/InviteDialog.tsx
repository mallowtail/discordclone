"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { inviteUrl } from "@/lib/invite";
import type { Server } from "@/types/db";

export function InviteDialog({
  server,
  isManager,
  onClose,
}: {
  server: Server;
  isManager: boolean;
  onClose: () => void;
}) {
  const supabase = createClient();
  const [code, setCode] = useState<string | null>(server.invite_code);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = code ? inviteUrl(code) : "";

  async function copy() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function regenerate() {
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("regenerate_invite", { srv: server.id });
    setBusy(false);
    if (err || !data) return setError("Couldn't regenerate — try again");
    setCode(data as string);
    setCopied(false);
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface p-5 rounded-xl w-96 border border-line" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-ink font-semibold mb-1">Invite people to {server.name}</h2>
        <p className="text-muted text-xs mb-3">Anyone with this link can join.</p>
        {error && <p className="text-danger text-sm mb-2">{error}</p>}
        <div className="flex gap-2">
          <input readOnly value={url} className="flex-1 p-2 rounded-lg bg-surface-2 text-ink text-sm" />
          <button onClick={copy}
            className="text-sm bg-accent hover:bg-accent-strong text-white rounded-lg px-3 disabled:opacity-50">
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        {isManager && (
          <button onClick={regenerate} disabled={busy}
            className="text-xs text-muted mt-3 hover:text-ink disabled:opacity-50">
            {busy ? "Regenerating…" : "Regenerate link (invalidates the old one)"}
          </button>
        )}
      </div>
    </div>
  );
}
