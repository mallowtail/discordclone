"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { parseInviteCode } from "@/lib/invite";
import type { Server } from "@/types/db";
import { ServerIcon } from "@/components/servers/ServerIcon";
import { Modal } from "@/components/ui/Modal";

export function AddServerDialog({ onClose }: { onClose: () => void }) {
  const supabase = createClient();
  const router = useRouter();
  const { user } = useAuth();
  const [tab, setTab] = useState<"create" | "join">("create");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [directory, setDirectory] = useState<Server[]>([]);
  const [inviteInput, setInviteInput] = useState("");

  useEffect(() => {
    supabase.from("servers").select("*").eq("is_public", true).then(({ data }) => setDirectory((data as Server[]) ?? []));
  }, [supabase]);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return setError("Enter a server name");
    setError(null);
    setBusy(true);
    const { data, error: err } = await supabase.rpc("create_server", { server_name: trimmed });
    setBusy(false);
    if (err) return setError("Couldn't create — try again");
    onClose();
    router.push(`/channels/first?server=${data}`);
  }

  async function join(serverId: string) {
    if (!user) return;
    const { error: err } = await supabase
      .from("server_members")
      .insert({ server_id: serverId, user_id: user.id });
    if (err && !err.message.includes("duplicate")) return setError("Couldn't join — try again");
    onClose();
    router.push(`/channels/first?server=${serverId}`);
  }

  async function joinByLink() {
    const code = parseInviteCode(inviteInput);
    if (!code) return setError("Enter an invite link or code");
    setError(null);
    setBusy(true);
    const { data, error: err } = await supabase.rpc("join_via_invite", { code });
    setBusy(false);
    if (err || !data) return setError("Invalid invite link");
    onClose();
    router.push(`/channels/first?server=${data}`);
  }

  return (
    <Modal onClose={onClose} size="sm">
      <div className="p-5">
        <div className="flex gap-2 mb-4 text-body">
          <button onClick={() => setTab("create")}
            className={`px-3 py-1 rounded-control ${tab === "create" ? "bg-accent text-white" : "text-muted"}`}>Create</button>
          <button onClick={() => setTab("join")}
            className={`px-3 py-1 rounded-control ${tab === "join" ? "bg-accent text-white" : "text-muted"}`}>Join</button>
        </div>
        {error && <p className="text-danger text-body mb-2">{error}</p>}
        {tab === "create" ? (
          <>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Server name"
              className="w-full p-2 rounded-control bg-surface-2 text-ink mb-3" />
            <button onClick={create} disabled={busy}
              className="w-full bg-accent hover:bg-accent-strong text-white font-medium rounded-control p-2 disabled:opacity-50">
              {busy ? "Creating…" : "Create server"}
            </button>
          </>
        ) : (
          <>
          <div className="mb-3">
            <label className="text-muted text-meta">Have an invite link?</label>
            <div className="flex gap-2 mt-1">
              <input value={inviteInput} onChange={(e) => setInviteInput(e.target.value)}
                placeholder="Paste invite link or code"
                className="flex-1 p-2 rounded-control bg-surface-2 text-ink text-body" />
              <button onClick={joinByLink} disabled={busy}
                className="text-body bg-accent hover:bg-accent-strong text-white rounded-control px-3 disabled:opacity-50">
                Join
              </button>
            </div>
          </div>
          <p className="text-muted text-meta mb-2">Public servers</p>
          <ul className="max-h-72 overflow-y-auto flex flex-col gap-1">
            {directory.map((s) => (
              <li key={s.id} className="flex items-center gap-2 p-2 rounded-control hover:bg-surface-2">
                <ServerIcon iconUrl={s.icon_url} name={s.name} />
                <span className="text-ink flex-1 truncate">{s.name}</span>
                <button onClick={() => join(s.id)}
                  className="text-meta bg-accent hover:bg-accent-strong text-white rounded-control px-3 py-1">Join</button>
              </li>
            ))}
            {directory.length === 0 && <li className="text-muted text-body p-2">No servers yet.</li>}
          </ul>
          </>
        )}
      </div>
    </Modal>
  );
}
