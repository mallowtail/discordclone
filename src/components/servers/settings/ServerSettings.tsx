"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isDeletedUsername } from "@/lib/users/account";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { useServerPermissions } from "@/hooks/useServerPermissions";
import { useMemberRoleColors } from "@/hooks/useMemberRoleColors";
import { useTopmostEscape } from "@/components/ui/overlayStack";
import { removeStorageFiles, uploadServerIcon } from "@/lib/media/upload";
import { canModerate } from "@/lib/servers/moderation";
import { describeAuditEntry, type AuditEntry } from "@/lib/servers/auditLog";
import { ServerIcon } from "@/components/servers/layout/ServerIcon";
import { RolesPanel } from "@/components/servers/roles/RolesDialog";
import { InvitesPanel } from "@/components/servers/dialogs/InviteDialog";
import { MemberModMenu } from "@/components/servers/members/MemberModMenu";
import { MemberRolesDialog } from "@/components/servers/members/MemberRolesDialog";
import { RolePill } from "@/components/servers/roles/RolePill";
import { Avatar } from "@/components/user/profile/Avatar";
import { StickersTab } from "@/components/servers/settings/StickersTab";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TypeToConfirmDialog } from "@/components/ui/TypeToConfirmDialog";
import { useVoice } from "@/components/providers/VoiceProvider";
import { storagePathFromPublicUrl } from "@/lib/media/url";
import { roomForChannel } from "@/lib/voice/rooms";
import { deleteServerErrorMessage, serverNameMatches, transferCandidates, transferErrorMessage } from "@/lib/servers/serverAdmin";
import type { Profile, Server } from "@/types/db";
import { Clock, MagnifyingGlass, ShieldStar, X } from "@phosphor-icons/react";

type Tab = "overview" | "roles" | "members" | "invites" | "bans" | "stickers" | "audit";

/**
 * Full-screen server settings with tabs down the side (like User Settings). Each tab only appears
 * for people allowed to use it; the database enforces the same permissions.
 */
export function ServerSettings({
  server,
  onSaved,
  onClose,
}: {
  server: Server;
  onSaved: () => void;
  onClose: () => void;
}) {
  const { has, isOwner, refresh: refreshPerms } = useServerPermissions(server.id);
  const canManageServer = isOwner || has("manage_server");
  const canManageRoles = isOwner || has("manage_roles");
  const canModerateAny = isOwner || has("kick_members") || has("ban_members") || has("timeout_members");
  const canBan = isOwner || has("ban_members");

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "overview", label: "Overview", show: true },
    { id: "roles", label: "Roles", show: canManageRoles },
    { id: "members", label: "Members", show: true },
    { id: "invites", label: "Invites", show: true },
    { id: "bans", label: "Bans", show: canBan },
    { id: "stickers", label: "Stickers", show: isOwner || has("manage_stickers") },
    { id: "audit", label: "Audit Log", show: canModerateAny || canManageServer },
  ];
  const [tab, setTab] = useState<Tab>("overview");
  useTopmostEscape(true, onClose);

  return (
    <div className="fixed inset-0 z-50 bg-app flex" role="dialog" aria-modal="true" aria-label={`${server.name} settings`}>
      <nav className="w-56 flex-none bg-sidebar border-r border-line flex flex-col p-3 gap-1 overflow-y-auto max-md:w-44">
        <div className="text-micro font-semibold uppercase tracking-wider text-muted px-3 py-2 truncate">{server.name}</div>
        {tabs.filter((t) => t.show).map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined}
            className={`w-full text-left text-body rounded-row px-3 py-1.5 min-h-11 md:min-h-0 ${
              tab === t.id ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"
            }`}>
            {t.label}
          </button>
        ))}
      </nav>
      <div className="flex-1 relative overflow-y-auto">
        <button type="button" onClick={onClose} title="Close (Esc)" aria-label="Close settings"
          className="absolute top-4 right-4 w-11 h-11 md:w-8 md:h-8 flex items-center justify-center rounded-pill text-muted hover:text-ink hover:bg-surface-2">
          <X size={18} weight="bold" />
        </button>
        <div className="p-5 md:p-8 max-w-2xl">
          {tab === "overview" && (
            <OverviewTab server={server} canManage={canManageServer} isOwner={isOwner} onSaved={onSaved} onClose={onClose}
              onOwnerChanged={() => { refreshPerms(); onSaved(); }} />
          )}
          {tab === "roles" && (<><Heading title="Roles" hint="Higher roles can manage people with lower ones." /><RolesPanel serverId={server.id} /></>)}
          {tab === "members" && <MembersTab server={server} />}
          {tab === "invites" && (<><Heading title="Invites" /><InvitesPanel server={server} isManager={canManageServer} /></>)}
          {tab === "bans" && <BansTab serverId={server.id} />}
          {tab === "stickers" && <StickersTab serverId={server.id} />}
          {tab === "audit" && <AuditTab serverId={server.id} />}
        </div>
      </div>
    </div>
  );
}

function Heading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-5 pr-12">
      <h2 className="text-title font-semibold text-ink tracking-tight">{title}</h2>
      {hint && <p className="mt-1 text-meta text-muted">{hint}</p>}
    </div>
  );
}

const field = "w-full rounded-control bg-surface-2 border border-line px-3 py-2 text-body text-ink outline-none focus:border-accent disabled:opacity-60";

function OverviewTab({ server, canManage, isOwner, onSaved, onClose, onOwnerChanged }: {
  server: Server; canManage: boolean; isOwner: boolean; onSaved: () => void; onClose: () => void; onOwnerChanged: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(server.name);
  const [description, setDescription] = useState(server.description ?? "");
  const [isPublic, setIsPublic] = useState(server.is_public);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  // Set by OwnerZone after a transfer; shown here because OwnerZone disappears once we're not the owner.
  const [ownerNotice, setOwnerNotice] = useState<string | null>(null);
  const dirty = name.trim() !== server.name || description.trim() !== (server.description ?? "") || isPublic !== server.is_public;

  async function save() {
    if (!name.trim()) return setStatus({ ok: false, text: "Enter a name" });
    setBusy(true);
    const { error } = await supabase.from("servers")
      .update({ name: name.trim(), description: description.trim() || null, is_public: isPublic }).eq("id", server.id);
    setBusy(false);
    if (error) return setStatus({ ok: false, text: "Couldn't save — try again" });
    setStatus({ ok: true, text: "Saved" });
    onSaved();
  }

  async function onPickIcon(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setStatus(null);
    const res = await uploadServerIcon(file);
    if ("error" in res) {
      setBusy(false);
      return setStatus({ ok: false, text: res.error });
    }
    const { error } = await supabase.from("servers").update({ icon_url: res.url }).eq("id", server.id);
    setBusy(false);
    if (error) return setStatus({ ok: false, text: "Couldn't save the icon — try again" });
    setStatus({ ok: true, text: "Icon updated" });
    onSaved();
  }

  async function leave() {
    if (!user) return;
    await supabase.from("server_members").delete().eq("server_id", server.id).eq("user_id", user.id);
    onClose();
    router.replace("/channels/first");
  }

  return (
    <>
      <Heading title="Overview" />
      <div className="flex items-center gap-4">
        <ServerIcon iconUrl={server.icon_url} name={server.name} size="lg" />
        {canManage && (
          <>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
              className="rounded-control border border-line px-3 py-1.5 text-body text-ink hover:bg-surface-2 disabled:opacity-50">
              Change icon
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickIcon} />
          </>
        )}
      </div>

      <label className="mt-6 block">
        <span className="block text-meta font-medium text-muted mb-1">Server name</span>
        <input value={name} onChange={(e) => { setName(e.target.value); setStatus(null); }} maxLength={100} disabled={!canManage} className={field} />
      </label>
      <label className="mt-4 block">
        <span className="block text-meta font-medium text-muted mb-1">Description</span>
        <textarea value={description} onChange={(e) => { setDescription(e.target.value); setStatus(null); }} maxLength={300} rows={3}
          disabled={!canManage} placeholder={canManage ? "What's this server about?" : "No description"} className={`${field} resize-none`} />
        <span className="block text-right text-micro text-muted">{description.length}/300</span>
      </label>
      <label className={`mt-3 flex items-start gap-3 ${canManage ? "cursor-pointer" : ""}`}>
        <input type="checkbox" checked={isPublic} disabled={!canManage} onChange={(e) => { setIsPublic(e.target.checked); setStatus(null); }}
          className="mt-1 w-4 h-4 accent-accent" />
        <span>
          <span className="block text-body text-ink">Public server</span>
          <span className="block text-meta text-muted">Anyone can join without an invite. Turn off to make it invite-only.</span>
        </span>
      </label>

      {canManage && (
        <div className="mt-6 flex items-center gap-3">
          <button type="button" onClick={save} disabled={busy || !dirty}
            className="rounded-control bg-accent hover:bg-accent-strong text-white text-body font-medium px-4 py-2 disabled:opacity-50">
            {busy ? "Saving…" : "Save changes"}
          </button>
          {status && <span role={status.ok ? "status" : "alert"} className={`text-meta ${status.ok ? "text-online" : "text-danger"}`}>{status.text}</span>}
        </div>
      )}

      {!isOwner && (
        <section className="mt-10 border-t border-line pt-6">
          {ownerNotice && <p role="status" className="mb-3 text-meta text-online">{ownerNotice}</p>}
          <button type="button" onClick={() => setConfirmLeave(true)}
            className="rounded-control border border-danger/50 px-4 py-2 text-body font-medium text-danger hover:bg-danger/10">
            Leave server
          </button>
        </section>
      )}
      {confirmLeave && (
        <ConfirmDialog title="Leave server" message={`Leave ${server.name}?`} confirmLabel="Leave" destructive
          onConfirm={() => { setConfirmLeave(false); leave(); }} onClose={() => setConfirmLeave(false)} />
      )}
      {isOwner && (
        <OwnerZone server={server} onClose={onClose}
          onTransferred={(text) => { setOwnerNotice(text); onOwnerChanged(); }} />
      )}
    </>
  );
}

type Candidate = { user_id: string; profile: Profile | null };

/** Owner only: pass the server on to another member, or delete it. */
function OwnerZone({ server, onTransferred, onClose }: { server: Server; onTransferred: (notice: string) => void; onClose: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const voice = useVoice();
  const [members, setMembers] = useState<Candidate[] | null>(null);
  const [newOwner, setNewOwner] = useState("");
  const [confirmTransfer, setConfirmTransfer] = useState(false);
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.from("server_members").select("user_id, profiles(*)").eq("server_id", server.id).then(({ data }) => {
      if (!active) return;
      const rows = ((data ?? []) as unknown as { user_id: string; profiles: Profile | null }[])
        .map((r) => ({ user_id: r.user_id, profile: r.profiles }));
      setMembers(transferCandidates(rows, server.owner_id));
    });
    return () => { active = false; };
  }, [supabase, server.id, server.owner_id]);

  const chosen = members?.find((m) => m.user_id === newOwner) ?? null;

  async function transfer() {
    if (!chosen) return;
    setConfirmTransfer(false);
    setTransferBusy(true);
    setTransferError(null);
    const { error } = await supabase.rpc("transfer_server_ownership", { srv: server.id, new_owner: chosen.user_id });
    setTransferBusy(false);
    if (error) return setTransferError(transferErrorMessage(error.message));
    setNewOwner("");
    onTransferred(`${chosen.profile?.display_name ?? "They"} now owns ${server.name}.`);
  }

  async function deleteServer(): Promise<string | null> {
    // Files first, while we still have permission to remove them (it goes with the server).
    const { data: stickers } = await supabase.from("stickers").select("path").eq("server_id", server.id);
    const stickerPaths = ((stickers ?? []) as { path: string }[]).map((s) => s.path);
    // Best effort: a file that won't go is logged by removeStorageFiles, and the deletion carries on.
    await removeStorageFiles("stickers", stickerPaths);
    const iconPath = storagePathFromPublicUrl(server.icon_url, "server-icons");
    if (iconPath) await removeStorageFiles("server-icons", [iconPath]);
    // In one of its voice channels? Leave before the channel disappears.
    const { data: channels } = await supabase.from("channels").select("id").eq("server_id", server.id);
    const rooms = new Set(((channels ?? []) as { id: string }[]).map((c) => roomForChannel(c.id)));
    if (voice.room && rooms.has(voice.room)) await voice.leave();

    const { error } = await supabase.rpc("delete_server", { srv: server.id });
    if (error) return deleteServerErrorMessage(error.message);
    onClose();
    router.replace("/dms");
    return null;
  }

  return (
    <>
      <section className="mt-10 border-t border-line pt-6">
        <h3 className="text-body font-semibold text-ink">Transfer ownership</h3>
        <p className="mt-1 text-meta text-muted">Make another member the owner. You&apos;ll stay in the server with your roles, but stop being the owner.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select value={newOwner} onChange={(e) => { setNewOwner(e.target.value); setTransferError(null); }}
            disabled={transferBusy || !members || members.length === 0} aria-label="New owner"
            className="min-w-0 flex-1 rounded-control bg-surface-2 border border-line px-3 py-2 text-body text-ink outline-none focus:border-accent disabled:opacity-60">
            <option value="">{members === null ? "Loading members…" : members.length === 0 ? "No one else is in this server" : "Choose a member…"}</option>
            {(members ?? []).map((m) => (
              <option key={m.user_id} value={m.user_id}>{m.profile?.display_name} (@{m.profile?.username})</option>
            ))}
          </select>
          <button type="button" onClick={() => setConfirmTransfer(true)} disabled={!chosen || transferBusy}
            className="rounded-control border border-line px-4 py-2 text-body font-medium text-ink hover:bg-surface-2 disabled:opacity-50">
            {transferBusy ? "Transferring…" : "Transfer"}
          </button>
        </div>
        {transferError && <p role="alert" className="mt-2 text-meta text-danger">{transferError}</p>}
      </section>

      <section className="mt-8 rounded-card border border-danger/40 p-4">
        <h3 className="text-body font-semibold text-danger">Delete server</h3>
        <p className="mt-1 text-meta text-muted">
          Deletes {server.name} for everyone: its channels, messages, roles, invites and stickers. This can&apos;t be undone.
        </p>
        <button type="button" onClick={() => setConfirmDelete(true)}
          className="mt-3 rounded-control bg-danger px-4 py-2 text-body font-medium text-white hover:bg-danger/90">
          Delete server
        </button>
      </section>

      {confirmTransfer && chosen && (
        <ConfirmDialog title="Transfer ownership"
          message={`Make ${chosen.profile?.display_name ?? "them"} the owner of ${server.name}? You'll stop being the owner, and only they can give it back.`}
          confirmLabel="Transfer" destructive onConfirm={transfer} onClose={() => setConfirmTransfer(false)} />
      )}
      {confirmDelete && (
        <TypeToConfirmDialog title="Delete server"
          message={<>This deletes <strong className="text-ink">{server.name}</strong> and everything in it for everyone. It can&apos;t be undone.</>}
          label="Type the server's name to confirm" confirmLabel="Delete server" busyLabel="Deleting…"
          canConfirm={(v) => serverNameMatches(v, server.name)} onConfirm={deleteServer} onClose={() => setConfirmDelete(false)} />
      )}
    </>
  );
}

type MemberRow = { user_id: string; joined_at: string; timeout_until: string | null; profile: Profile | null };

function MembersTab({ server }: { server: Server }) {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const { has, isOwner, rank } = useServerPermissions(server.id);
  const { rolesFor, colorFor } = useMemberRoleColors(server.id);
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [managing, setManaging] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("server_members").select("user_id, joined_at, timeout_until, profiles(*)").eq("server_id", server.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setMembers(((data ?? []) as any[]).map((m) => ({ user_id: m.user_id, joined_at: m.joined_at, timeout_until: m.timeout_until, profile: m.profiles }))
      .sort((a, b) => (a.profile?.display_name ?? "").localeCompare(b.profile?.display_name ?? "", undefined, { sensitivity: "base" })));
  }, [supabase, server.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch of the member list
    load();
  }, [load]);

  const q = query.trim().toLowerCase().replace(/^@/, "");
  const shown = (members ?? []).filter((m) => !q || m.profile?.display_name.toLowerCase().includes(q) || m.profile?.username.toLowerCase().includes(q));

  return (
    <>
      <Heading title={`Members${members ? ` — ${members.length}` : ""}`} hint="Manage roles, time people out, kick or ban. You can only act on people below your highest role." />
      <div className="flex items-center gap-2 rounded-control bg-surface-2 border border-line px-2 focus-within:border-accent mb-3">
        <MagnifyingGlass size={15} className="text-muted flex-none" aria-hidden="true" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search members" aria-label="Search members"
          className="flex-1 min-w-0 bg-transparent py-2 text-body text-ink outline-none" />
      </div>
      {members === null ? (
        <p className="text-body text-muted">Loading…</p>
      ) : (
        <ul className="divide-y divide-line border border-line rounded-card">
          {shown.map((m) => {
            const targetRank = rolesFor(m.user_id).reduce((mx, r) => Math.max(mx, r.position), -1);
            const ctx = { isOwner, viewerRank: rank ?? -1, targetRank, targetIsOwner: m.user_id === server.owner_id, targetIsSelf: m.user_id === user?.id };
            const timedOut = !!m.timeout_until && new Date(m.timeout_until) > new Date();
            const name = m.profile?.display_name ?? "Unknown";
            return (
              <li key={m.user_id} className="flex items-center gap-3 px-3 py-2.5">
                <Avatar url={m.profile?.avatar_url ?? null} name={name} seed={m.user_id} size="md" deleted={isDeletedUsername(m.profile?.username)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="truncate text-body font-medium text-ink" style={{ color: colorFor(m.user_id) ?? undefined }}>{name}</span>
                    {m.user_id === server.owner_id && <span className="flex-none text-micro text-amber">Owner</span>}
                    {timedOut && (
                      <span className="flex-none text-muted" title={`Timed out until ${new Date(m.timeout_until!).toLocaleString()}`}>
                        <Clock size={13} weight="fill" aria-label="Timed out" />
                      </span>
                    )}
                  </div>
                  <div className="text-meta text-muted truncate">
                    @{m.profile?.username ?? "unknown"} · joined {new Date(m.joined_at).toLocaleDateString()}
                  </div>
                  {rolesFor(m.user_id).length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">{rolesFor(m.user_id).map((r) => <RolePill key={r.id} role={r} />)}</div>
                  )}
                </div>
                {(isOwner || has("manage_roles")) && (
                  <button type="button" onClick={() => setManaging(m.user_id)} title="Manage roles" aria-label={`Manage ${name}'s roles`}
                    className="flex-none flex items-center justify-center w-11 h-11 md:w-8 md:h-8 rounded-control text-muted hover:text-ink hover:bg-surface-2">
                    <ShieldStar size={17} />
                  </button>
                )}
                <MemberModMenu serverId={server.id} targetId={m.user_id} targetName={name} timedOut={timedOut}
                  canKick={canModerate({ ...ctx, hasPerm: has("kick_members") })}
                  canBan={canModerate({ ...ctx, hasPerm: has("ban_members") })}
                  canTimeout={canModerate({ ...ctx, hasPerm: has("timeout_members") })}
                  onDone={load} />
              </li>
            );
          })}
          {shown.length === 0 && <li className="px-3 py-3 text-body text-muted">No one matches that.</li>}
        </ul>
      )}
      {managing && <MemberRolesDialog serverId={server.id} userId={managing} onClose={() => setManaging(null)} />}
    </>
  );
}

type BanRow = { user_id: string; reason: string | null; created_at: string; profile: Profile | null; by: Profile | null };

function BansTab({ serverId }: { serverId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [bans, setBans] = useState<BanRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("bans")
      .select("user_id, reason, created_at, profile:profiles!bans_user_id_fkey(*), by:profiles!bans_banned_by_fkey(*)")
      .eq("server_id", serverId).order("created_at", { ascending: false });
    setBans((data as unknown as BanRow[] | null) ?? []);
  }, [supabase, serverId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch of the ban list
    load();
  }, [load]);

  async function unban(userId: string) {
    setBusy(userId);
    await supabase.rpc("unban_member", { srv: serverId, target: userId });
    setBusy(null);
    load();
  }

  return (
    <>
      <Heading title={`Bans${bans ? ` — ${bans.length}` : ""}`} hint="Banned people can't rejoin, even with an invite, until they're unbanned." />
      {bans === null ? (
        <p className="text-body text-muted">Loading…</p>
      ) : bans.length === 0 ? (
        <p className="text-body text-muted">Nobody is banned.</p>
      ) : (
        <ul className="divide-y divide-line border border-line rounded-card">
          {bans.map((b) => (
            <li key={b.user_id} className="flex items-start gap-3 px-3 py-2.5">
              <Avatar url={b.profile?.avatar_url ?? null} name={b.profile?.display_name} seed={b.user_id} size="md" deleted={isDeletedUsername(b.profile?.username)} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-body font-medium text-ink">{b.profile?.display_name ?? "Deleted user"} <span className="font-normal text-muted">@{b.profile?.username ?? "?"}</span></div>
                <div className="text-meta text-muted">
                  Banned {new Date(b.created_at).toLocaleDateString()}{b.by && <> by {b.by.display_name}</>}
                </div>
                <div className="text-meta text-ink mt-0.5 break-words">{b.reason ? `Reason: ${b.reason}` : <span className="text-muted">No reason given</span>}</div>
              </div>
              <button type="button" onClick={() => unban(b.user_id)} disabled={busy === b.user_id}
                className="flex-none rounded-control border border-line px-3 py-1.5 text-meta text-ink hover:bg-surface-2 disabled:opacity-50">
                {busy === b.user_id ? "…" : "Unban"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function AuditTab({ serverId }: { serverId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);

  useEffect(() => {
    let active = true;
    supabase.from("audit_log")
      .select("id, action, reason, until, created_at, actor:profiles!audit_log_actor_id_fkey(display_name), target:profiles!audit_log_target_id_fkey(display_name)")
      .eq("server_id", serverId).order("created_at", { ascending: false }).limit(100)
      .then(({ data }) => { if (active) setEntries((data as unknown as AuditEntry[] | null) ?? []); });
    return () => { active = false; };
  }, [supabase, serverId]);

  return (
    <>
      <Heading title="Audit Log" hint="Kicks, bans, unbans and timeouts — newest first (last 100)." />
      {entries === null ? (
        <p className="text-body text-muted">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-body text-muted">Nothing yet. Moderation actions will show up here.</p>
      ) : (
        <ul className="divide-y divide-line border border-line rounded-card">
          {entries.map((e) => (
            <li key={e.id} className="px-3 py-2.5">
              <div className="text-body text-ink">{describeAuditEntry(e)}</div>
              <div className="text-meta text-muted">
                {new Date(e.created_at).toLocaleString()}
                {e.reason && <> · Reason: {e.reason}</>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
