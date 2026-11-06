"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import {
  DEFAULT_EXPIRY_SECONDS,
  EXPIRY_OPTIONS,
  MAX_USES_OPTIONS,
  formatTimeLeft,
  inviteStatus,
  inviteUrl,
  validateVanityCode,
} from "@/lib/invite";
import { Modal } from "@/components/ui/Modal";
import type { Invite, Server } from "@/types/db";

const selectClass =
  "w-full px-3 py-2 rounded-control bg-surface-2 text-ink text-body border border-line focus:outline-none focus:border-accent";
const primaryButton =
  "rounded-control bg-accent hover:bg-accent-strong text-white text-body font-medium px-3 py-2 disabled:opacity-50";

/** A read-only link with a Copy button. */
function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setFailed(true);
    }
  }
  return (
    <div>
      <div className="flex gap-2">
        <input readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()}
          className="flex-1 min-w-0 px-3 py-2 rounded-control bg-surface-2 text-ink text-body border border-line" />
        <button type="button" onClick={copy} className={primaryButton}>{copied ? "Copied" : "Copy"}</button>
      </div>
      {failed && <p className="text-danger text-meta mt-1">Couldn&apos;t copy — select the link and copy it manually.</p>}
    </div>
  );
}

export function InviteDialog({
  server,
  isManager,
  onClose,
}: {
  server: Server;
  isManager: boolean;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const isOwner = !!user && user.id === server.owner_id;

  const [invites, setInvites] = useState<Invite[]>([]);
  const vanity = invites.find((i) => i.is_vanity) ?? null;
  const regular = invites.filter((i) => !i.is_vanity);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("invites")
      .select("*")
      .eq("server_id", server.id)
      .order("created_at", { ascending: false });
    setInvites((data as Invite[] | null) ?? []);
  }, [supabase, server.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch of this server's invites
    load();
  }, [load]);

  return (
    <Modal onClose={onClose} title={`Invite people to ${server.name}`} size="md">
      <div className="p-5 space-y-6">
        {vanity && !isOwner && (
          <section>
            <h3 className="text-meta font-medium text-muted mb-1">Server link</h3>
            <CopyField value={inviteUrl(vanity.code)} label="Server invite link" />
          </section>
        )}
        <CreateInvite serverId={server.id} onCreated={load} />
        {isOwner && <VanityEditor serverId={server.id} current={vanity?.code ?? null} onSaved={load} />}
        {isManager && <ActiveInvites invites={regular} onChanged={load} />}
      </div>
    </Modal>
  );
}

function CreateInvite({ serverId, onCreated }: { serverId: string; onCreated: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [expiry, setExpiry] = useState<number | null>(DEFAULT_EXPIRY_SECONDS);
  const [limit, setLimit] = useState<number | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("create_invite", {
      srv: serverId,
      expires_in: expiry,
      use_limit: limit,
    });
    setBusy(false);
    if (err || !data) return setError("Couldn't create an invite — try again");
    setCode(data as string);
    onCreated();
  }

  return (
    <section>
      <h3 className="text-title font-semibold text-ink mb-3">Create an invite</h3>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <label className="block">
          <span className="block text-meta font-medium text-muted mb-1">Expire after</span>
          <select className={selectClass} value={expiry ?? "never"}
            onChange={(e) => setExpiry(e.target.value === "never" ? null : Number(e.target.value))}>
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.label} value={o.seconds ?? "never"}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-meta font-medium text-muted mb-1">Max uses</span>
          <select className={selectClass} value={limit ?? "none"}
            onChange={(e) => setLimit(e.target.value === "none" ? null : Number(e.target.value))}>
            {MAX_USES_OPTIONS.map((o) => (
              <option key={o.label} value={o.uses ?? "none"}>{o.label}</option>
            ))}
          </select>
        </label>
      </div>
      {error && <p role="alert" className="text-danger text-meta mb-2">{error}</p>}
      {code ? (
        <div className="space-y-2">
          <CopyField value={inviteUrl(code)} label="New invite link" />
          <button type="button" onClick={() => setCode(null)} className="text-meta text-muted hover:text-ink">
            Make another
          </button>
        </div>
      ) : (
        <button type="button" onClick={create} disabled={busy} className={`w-full ${primaryButton}`}>
          {busy ? "Creating…" : "Generate link"}
        </button>
      )}
    </section>
  );
}

function VanityEditor({ serverId, current, onSaved }: { serverId: string; current: string | null; onSaved: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  // null until the owner edits: the field shows the saved custom link until then.
  const [typed, setTyped] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = typed ?? current ?? "";

  async function save(next: string | null) {
    setError(null);
    if (next !== null) {
      const v = validateVanityCode(next);
      if (!v.ok) return setError(v.error);
      next = v.value;
    }
    setBusy(true);
    const { error: err } = await supabase.rpc("set_vanity_invite", { srv: serverId, vanity: next });
    setBusy(false);
    if (err) {
      return setError(err.message.includes("taken") ? "That link is already taken — try another" : "Couldn't save — try again");
    }
    setTyped(null);
    onSaved();
  }

  const dirty = typed !== null && typed.trim() !== (current ?? "");
  return (
    <section>
      <h3 className="text-title font-semibold text-ink mb-1">Custom invite link</h3>
      <p className="text-meta text-muted mb-3">Optional. Pick your own link text — it never expires. Only you can change it.</p>
      <div className="flex items-center rounded-control bg-surface-2 border border-line focus-within:border-accent">
        <span className="pl-3 text-body text-muted whitespace-nowrap">/invite/</span>
        <input value={value} onChange={(e) => setTyped(e.target.value)} placeholder="your-link" aria-label="Custom invite link"
          aria-invalid={error ? true : undefined}
          className="flex-1 min-w-0 px-1 py-2 bg-transparent text-ink text-body focus:outline-none" />
      </div>
      <p className="text-meta text-muted mt-1">2–32 letters, numbers, or hyphens. Capitals are fine — links work in any case.</p>
      {error && <p role="alert" className="text-danger text-meta mt-1">{error}</p>}
      <div className="flex gap-2 mt-3">
        <button type="button" onClick={() => save(value)} disabled={busy || !dirty} className={primaryButton}>
          {busy ? "Saving…" : "Save"}
        </button>
        {current && (
          <button type="button" onClick={() => save(null)} disabled={busy}
            className="rounded-control px-3 py-2 text-body text-muted hover:text-danger disabled:opacity-50">
            Remove
          </button>
        )}
      </div>
      {current && !dirty && <div className="mt-3"><CopyField value={inviteUrl(current)} label="Your custom invite link" /></div>}
    </section>
  );
}

function ActiveInvites({ invites, onChanged }: { invites: Invite[]; onChanged: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function revoke(code: string) {
    setBusyCode(code);
    setError(null);
    const { error: err } = await supabase.rpc("revoke_invite", { invite_code: code });
    setBusyCode(null);
    if (err) return setError("Couldn't revoke — try again");
    onChanged();
  }

  return (
    <section>
      <h3 className="text-title font-semibold text-ink mb-3">Invites</h3>
      {error && <p role="alert" className="text-danger text-meta mb-2">{error}</p>}
      {invites.length === 0 ? (
        <p className="text-body text-muted">No invites yet.</p>
      ) : (
        <ul className="divide-y divide-line border border-line rounded-card overflow-hidden">
          {invites.map((inv) => {
            const status = inviteStatus(inv);
            const uses = inv.max_uses === null ? `${inv.uses} uses` : `${inv.uses} / ${inv.max_uses} uses`;
            const state = status === "expired" ? "Expired" : status === "used_up" ? "Used up" : formatTimeLeft(inv.expires_at);
            return (
              <li key={inv.code} className={`flex items-center gap-3 px-3 py-2 ${status === "ok" ? "" : "opacity-60"}`}>
                <span className="font-mono text-body text-ink truncate flex-1 min-w-0">{inv.code}</span>
                <span className="text-meta text-muted whitespace-nowrap">{uses}</span>
                <span className="text-meta text-muted whitespace-nowrap w-16 text-right" title="Time left">{state}</span>
                <button type="button" onClick={() => revoke(inv.code)} disabled={busyCode === inv.code}
                  className="text-meta text-muted hover:text-danger disabled:opacity-50">
                  {busyCode === inv.code ? "…" : "Revoke"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
