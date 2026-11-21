"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { useServerPermissions } from "@/hooks/useServerPermissions";
import { useMemberRoleColors } from "@/hooks/useMemberRoleColors";
import { ReportCard, MarkHandledButton } from "@/components/reports/ReportCard";
import { MemberModMenu } from "@/components/servers/members/MemberModMenu";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { canModerate } from "@/lib/servers/moderation";
import { isDeletedProfile } from "@/lib/users/account";
import { jumpLink, modDeleteErrorMessage, openReportCount, personName, type ReportRow } from "@/lib/reports/reports";
import { chunkIds } from "@/lib/messages/reactions";
import type { Server } from "@/types/db";

type Member = { user_id: string; timeout_until: string | null };

/**
 * Server Settings → Reports (View Reports; owners always): message reports from this server's
 * channels. The list itself comes from useServerReports (row-level security decides what's in it);
 * this adds what each card needs to act: is the message still there, is its author still a member.
 */
export function ReportsTab({ server, reports, error, reload, onClose }: {
  server: Server;
  reports: ReportRow[] | null;
  error: boolean;
  reload: () => void;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { user } = useAuth();
  const { has, isOwner, rank } = useServerPermissions(server.id);
  const { rolesFor } = useMemberRoleColors(server.id);
  const canDelete = isOwner || has("manage_messages");
  const [view, setView] = useState<"open" | "handled">("open");
  // message id → its channel, for messages that still exist (deleted ones aren't returned).
  // `key` is the id list the map was loaded for, so cards don't claim "deleted" / "not in the
  // server" before the lookup has answered; `failed` means it couldn't be checked (an empty map
  // then proves nothing, so neither claim is made and the actions stay available).
  const [live, setLive] = useState<{ key: string; failed: boolean; map: Map<string, string | null> }>({ key: "", failed: false, map: new Map() });
  const [members, setMembers] = useState<{ key: string; failed: boolean; map: Map<string, Member> }>({ key: "", failed: false, map: new Map() });
  const [deleting, setDeleting] = useState<ReportRow | null>(null);
  const [actionError, setActionError] = useState<{ id: string; text: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const messageIds = [...new Set((reports ?? []).map((r) => r.message_id).filter((x): x is string => !!x))].sort().join(",");
  const targetIds = [...new Set((reports ?? []).map((r) => r.target_user_id).filter((x): x is string => !!x))].sort().join(",");

  useEffect(() => {
    if (!messageIds) return;
    let active = true;
    // ≤100 ids per request: `.in()` goes into the URL.
    Promise.all(chunkIds(messageIds.split(",")).map((ids) => supabase.from("messages").select("id, channel_id").in("id", ids)))
      .then((pages) => {
        if (!active) return;
        const rows = pages.flatMap((p) => (p.data ?? []) as { id: string; channel_id: string | null }[]);
        setLive({ key: messageIds, failed: pages.some((p) => p.error), map: new Map(rows.map((m) => [m.id, m.channel_id])) });
      }, () => { if (active) setLive({ key: messageIds, failed: true, map: new Map() }); });
    return () => { active = false; };
  }, [supabase, messageIds, refreshKey]);

  useEffect(() => {
    if (!targetIds) return;
    let active = true;
    Promise.all(chunkIds(targetIds.split(",")).map((ids) =>
      supabase.from("server_members").select("user_id, timeout_until").eq("server_id", server.id).in("user_id", ids)))
      .then((pages) => {
        if (!active) return;
        const rows = pages.flatMap((p) => (p.data ?? []) as Member[]);
        setMembers({ key: targetIds, failed: pages.some((p) => p.error), map: new Map(rows.map((m) => [m.user_id, m])) });
      }, () => { if (active) setMembers({ key: targetIds, failed: true, map: new Map() }); });
    return () => { active = false; };
  }, [supabase, server.id, targetIds, refreshKey]);

  const refresh = () => { setRefreshKey((k) => k + 1); reload(); };

  async function deleteMessage(r: ReportRow) {
    setDeleting(null);
    setActionError(null);
    const { error: err } = await supabase.rpc("delete_message_as_mod", { msg: r.message_id });
    if (err) setActionError({ id: r.id, text: modDeleteErrorMessage(err.message) });
    refresh();
  }

  function jump(href: string) {
    onClose();
    router.push(href);
  }

  const open = (reports ?? []).filter((r) => r.status === "open");
  const handled = (reports ?? []).filter((r) => r.status === "handled");
  const shown = view === "open" ? open : handled;

  return (
    <>
      <div className="mb-5 pr-12">
        <h2 className="text-title font-semibold text-ink tracking-tight">Reports</h2>
        <p className="mt-1 text-meta text-muted">
          Messages people reported in this server. Reports about anyone who can view reports go only to the Mallowchat admin.
        </p>
      </div>
      <div className="mb-4 flex gap-1" role="tablist" aria-label="Which reports">
        {(["open", "handled"] as const).map((v) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
            className={`rounded-control px-3 py-1.5 min-h-11 md:min-h-0 text-body ${view === v ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"}`}>
            {v === "open" ? `Open${reports ? ` (${openReportCount(reports)})` : ""}` : "Handled"}
          </button>
        ))}
      </div>

      {error && !reports ? (
        <p role="alert" className="text-body text-danger">Couldn&apos;t load reports — try again.</p>
      ) : reports === null ? (
        <p className="text-body text-muted">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-body text-muted">{view === "open" ? "No open reports. Nice and quiet." : "No handled reports yet."}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {shown.map((r) => {
            const liveLoaded = live.key === messageIds;
            const membersLoaded = members.key === targetIds;
            const liveUnknown = liveLoaded && live.failed;
            const membersUnknown = membersLoaded && members.failed;
            const channelId = r.message_id ? live.map.get(r.message_id) : undefined;
            const exists = channelId !== undefined;
            const href = exists ? jumpLink(channelId ?? null, r.message_id) : null;
            const target = r.target_user_id;
            const member = target ? members.map.get(target) : undefined;
            const targetName = personName(r.target);
            const targetRank = target ? rolesFor(target).reduce((mx, role) => Math.max(mx, role.position), -1) : -1;
            const ctx = { isOwner, viewerRank: rank ?? -1, targetRank, targetIsOwner: target === server.owner_id, targetIsSelf: target === user?.id };
            const timedOut = !!member?.timeout_until && new Date(member.timeout_until) > new Date();
            // Couldn't check membership: offer the menu anyway (the database refuses a non-member).
            const canMod = !!target && (!!member || membersUnknown) && !isDeletedProfile(r.target);
            return (
              <div key={r.id}>
                <ReportCard report={r} actions={
                  <>
                    {href ? (
                      <button type="button" onClick={() => jump(href)}
                        className="rounded-control border border-line px-3 py-1.5 min-h-11 md:min-h-0 text-meta font-medium text-ink hover:bg-surface-2">
                        Jump to message
                      </button>
                    ) : liveUnknown ? (
                      <span className="text-meta text-muted">Couldn&apos;t check whether the message is still there.</span>
                    ) : liveLoaded ? (
                      <span className="text-meta text-muted">The message has been deleted.</span>
                    ) : null}
                    {(exists || (liveUnknown && !!r.message_id)) && canDelete && (
                      <button type="button" onClick={() => setDeleting(r)}
                        className="rounded-control border border-danger/50 px-3 py-1.5 min-h-11 md:min-h-0 text-meta font-medium text-danger hover:bg-danger/10">
                        Delete message
                      </button>
                    )}
                    {canMod && target && (
                      <MemberModMenu serverId={server.id} targetId={target} targetName={targetName} timedOut={timedOut} label="Moderate user"
                        canKick={canModerate({ ...ctx, hasPerm: has("kick_members") })}
                        canBan={canModerate({ ...ctx, hasPerm: has("ban_members") })}
                        canTimeout={canModerate({ ...ctx, hasPerm: has("timeout_members") })}
                        onDone={refresh} />
                    )}
                    {target && membersLoaded && !membersUnknown && !member && !isDeletedProfile(r.target) && (
                      <span className="text-meta text-muted">{targetName} isn&apos;t in the server anymore.</span>
                    )}
                    {r.status === "open" && <MarkHandledButton reportId={r.id} onDone={reload} />}
                  </>
                } />
                {actionError?.id === r.id && <p role="alert" className="mt-1 text-meta text-danger">{actionError.text}</p>}
              </div>
            );
          })}
        </div>
      )}

      {deleting && (
        <ConfirmDialog title="Delete message"
          message={`Delete this message by ${personName(deleting.target)} for everyone? It's recorded in the audit log. The report stays.`}
          confirmLabel="Delete" destructive onConfirm={() => deleteMessage(deleting)} onClose={() => setDeleting(null)} />
      )}
    </>
  );
}
