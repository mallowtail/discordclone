"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useVoice } from "@/components/providers/VoiceProvider";
import { TypeToConfirmDialog } from "@/components/ui/TypeToConfirmDialog";
import { serverNameMatches } from "@/lib/servers/serverAdmin";
import { adminDeleteServer } from "@/components/admin/adminActions";

/** "Delete server" for the site admin: type the name to confirm, then `admin_delete_server` + its files. */
export function AdminDeleteServerButton({ server, onDeleted, label = "Delete server" }: {
  server: { id: string; name: string };
  onDeleted: () => void;
  label?: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const voice = useVoice();
  const [confirming, setConfirming] = useState(false);

  async function remove(): Promise<string | null> {
    const err = await adminDeleteServer(supabase, server.id, voice);
    if (err) return err;
    setConfirming(false);
    onDeleted();
    return null;
  }

  return (
    <>
      <button type="button" onClick={() => setConfirming(true)}
        className="rounded-control border border-danger/50 px-3 py-1.5 min-h-11 md:min-h-0 text-meta font-medium text-danger hover:bg-danger/10">
        {label}
      </button>
      {confirming && (
        <TypeToConfirmDialog title="Delete server"
          message={<>This deletes <strong className="text-ink">{server.name}</strong> for everyone: its channels, messages, roles, invites, icon and stickers. It can&apos;t be undone.</>}
          label="Type the server's name to confirm" confirmLabel="Delete server" busyLabel="Deleting…"
          canConfirm={(v) => serverNameMatches(v, server.name)} onConfirm={remove} onClose={() => setConfirming(false)} />
      )}
    </>
  );
}
