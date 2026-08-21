"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { TIMEOUT_PRESETS } from "@/lib/moderation";
import { DotsThree, Clock, Prohibit, UserMinus } from "@phosphor-icons/react";

export function MemberModMenu({
  serverId, targetId, targetName, timedOut, canKick, canBan, canTimeout, onDone,
}: {
  serverId: string;
  targetId: string;
  targetName: string;
  timedOut: boolean;
  canKick: boolean;
  canBan: boolean;
  canTimeout: boolean;
  onDone: () => void;
}) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [banning, setBanning] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setBanning(false); } }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") { setOpen(false); setBanning(false); } }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  async function run(fn: () => PromiseLike<{ error: unknown }>) {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    setOpen(false);
    setBanning(false);
    if (!error) onDone();
  }

  function timeoutFor(ms: number) {
    return run(() => supabase.rpc("timeout_member", { srv: serverId, target: targetId, until: new Date(Date.now() + ms).toISOString() }));
  }
  function clearTimeout_() {
    return run(() => supabase.rpc("timeout_member", { srv: serverId, target: targetId, until: null }));
  }
  function kick() {
    if (!confirm(`Kick ${targetName}? They can rejoin with an invite.`)) return;
    return run(() => supabase.rpc("kick_member", { srv: serverId, target: targetId }));
  }
  function ban() {
    return run(() => supabase.rpc("ban_member", { srv: serverId, target: targetId, reason: reason.trim() || null }));
  }

  if (!canKick && !canBan && !canTimeout) return null;

  return (
    <div className="relative flex-none" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} title="Moderate" aria-label="Moderate"
        className="text-muted hover:text-ink flex-none">
        <DotsThree size={18} weight="bold" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-44 rounded-xl border border-line bg-surface shadow-lg py-1 text-sm">
          {banning ? (
            <div className="px-3 py-2">
              <p className="text-ink mb-1">Ban {targetName}?</p>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)"
                className="w-full p-1.5 rounded-lg bg-surface-2 text-ink text-xs mb-2" />
              <div className="flex gap-2">
                <button disabled={busy} onClick={ban} className="flex-1 bg-danger/90 hover:bg-danger text-white rounded-lg py-1 disabled:opacity-50">Ban</button>
                <button onClick={() => setBanning(false)} className="flex-1 bg-surface-2 hover:bg-line text-ink rounded-lg py-1">Cancel</button>
              </div>
            </div>
          ) : (
            <>
              {canTimeout && (
                <>
                  <div className="px-3 pt-1 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted flex items-center gap-1"><Clock size={12} /> Timeout</div>
                  {TIMEOUT_PRESETS.map((p) => (
                    <button key={p.label} disabled={busy} onClick={() => timeoutFor(p.ms)}
                      className="w-full px-4 py-1 text-left text-ink hover:bg-surface-2 disabled:opacity-50">{p.label}</button>
                  ))}
                  {timedOut && (
                    <button disabled={busy} onClick={clearTimeout_}
                      className="w-full px-4 py-1 text-left text-ink hover:bg-surface-2 disabled:opacity-50">Remove timeout</button>
                  )}
                </>
              )}
              {canKick && (
                <button disabled={busy} onClick={kick}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-ink hover:bg-surface-2 disabled:opacity-50"><UserMinus size={15} /> Kick</button>
              )}
              {canBan && (
                <button disabled={busy} onClick={() => setBanning(true)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-danger hover:bg-surface-2 disabled:opacity-50"><Prohibit size={15} /> Ban</button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
