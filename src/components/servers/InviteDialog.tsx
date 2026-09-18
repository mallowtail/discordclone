"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { inviteUrl } from "@/lib/invite";
import { Modal } from "@/components/ui/Modal";
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
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy — copy the link manually");
    }
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
    <Modal onClose={onClose} title={`Invite people to ${server.name}`} size="sm">
      <div className="p-5">
        <p className="text-muted text-meta mb-3">Anyone with this link can join.</p>
        {error && <p className="text-danger text-body mb-2">{error}</p>}
        <div className="flex gap-2">
          <input readOnly value={url} aria-label="Invite link" className="flex-1 p-2 rounded-control bg-surface-2 text-ink text-body" />
          <button onClick={copy}
            className="text-body bg-accent hover:bg-accent-strong text-white rounded-control px-3 disabled:opacity-50">
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        {isManager && (
          <button onClick={regenerate} disabled={busy}
            className="text-meta text-muted mt-3 hover:text-ink disabled:opacity-50">
            {busy ? "Regenerating…" : "Regenerate link (invalidates the old one)"}
          </button>
        )}
      </div>
    </Modal>
  );
}
