"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { useProfilePopover } from "@/components/providers/ProfilePopoverProvider";
import { usePresence } from "@/hooks/usePresence";
import { MAX_GROUP_SIZE, groupErrorMessage, type ConversationSummary } from "@/lib/users/conversations";
import { Avatar } from "@/components/user/profile/Avatar";
import { PeoplePickerDialog } from "@/components/dms/sidebar/PeoplePickerDialog";
import { Crown, PencilSimple, SignOut, UserMinus, UserPlus } from "@phosphor-icons/react";

/** A "…?" confirm that quietly backs out after a few seconds. */
function useConfirm() {
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return [armed, setArmed] as const;
}

const actionButton =
  "flex w-full items-center gap-2 rounded-row px-2 py-1.5 min-h-11 md:min-h-0 text-body text-muted hover:bg-surface hover:text-ink disabled:opacity-50";

/**
 * Right-hand panel for a group chat: who's in it (owner marked), and the group's actions. Anyone can
 * add people, rename, or leave; the owner can also remove people and hand ownership over.
 */
export function GroupMembersPanel({ conv }: { conv: ConversationSummary }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { user } = useAuth();
  const { open } = useProfilePopover();
  const { isOnline } = usePresence();
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useConfirm();

  const isOwner = !!user && conv.ownerId === user.id;
  const full = conv.members.length >= MAX_GROUP_SIZE;
  const members = [...conv.members].sort((a, b) =>
    a.id === conv.ownerId ? -1 : b.id === conv.ownerId ? 1 : a.display_name.localeCompare(b.display_name, undefined, { sensitivity: "base" })
  );

  async function call(fn: string, args: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc(fn, args);
    setBusy(false);
    setArmed(null);
    if (err) setError(groupErrorMessage(err.message));
    return !err;
  }

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    if (await call("rename_group", { conv_id: conv.id, new_name: draftName })) setRenaming(false);
  }

  async function leave() {
    if (await call("leave_group", { conv_id: conv.id })) router.push("/dms");
  }

  return (
    <aside className="w-72 max-w-[85vw] xl:w-[clamp(12.5rem,16vw,15rem)] h-full bg-sidebar border-l border-line flex flex-col">
      <div className="p-3 text-title font-semibold text-ink tracking-tight border-b border-line">
        Members — {conv.members.length}
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <ul>
          {members.map((m) => {
            const me = m.id === user?.id;
            const owner = m.id === conv.ownerId;
            return (
              <li key={m.id} className="group/row flex items-center gap-1 rounded-row hover:bg-surface/60">
                <button type="button" onClick={(e) => open(m.id, e.currentTarget.getBoundingClientRect())}
                  aria-label={`View ${m.display_name}'s profile`}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 min-h-11 md:min-h-0 text-left">
                  <Avatar url={m.avatar_url} name={m.display_name} seed={m.id}
                    presence={isOnline(m.id) ? "online" : "offline"} presenceRing="ring-sidebar" size="sm" />
                  <span className="min-w-0 truncate text-body text-ink">{m.display_name}{me && <span className="text-muted"> (you)</span>}</span>
                  {owner && <Crown size={14} weight="fill" className="flex-none text-amber" aria-label="Group owner" />}
                </button>
                {isOwner && !me && (
                  armed === `kick:${m.id}` ? (
                    <button type="button" disabled={busy} autoFocus
                      onClick={() => call("kick_group_member", { conv_id: conv.id, target_id: m.id })}
                      className="flex-none rounded-row bg-danger/15 px-2 py-1 text-micro font-medium text-danger hover:bg-danger/25">
                      Remove?
                    </button>
                  ) : armed === `owner:${m.id}` ? (
                    <button type="button" disabled={busy} autoFocus
                      onClick={() => call("transfer_group_ownership", { conv_id: conv.id, target_id: m.id })}
                      className="flex-none rounded-row bg-amber/15 px-2 py-1 text-micro font-medium text-amber hover:bg-amber/25">
                      Make owner?
                    </button>
                  ) : (
                    <span className="flex flex-none items-center md:opacity-0 md:group-hover/row:opacity-100 md:group-focus-within/row:opacity-100">
                      <button type="button" onClick={() => setArmed(`owner:${m.id}`)} title="Make owner"
                        aria-label={`Make ${m.display_name} the owner`}
                        className="flex items-center justify-center w-11 h-11 md:w-7 md:h-7 rounded-row text-muted hover:text-amber">
                        <Crown size={15} aria-hidden="true" />
                      </button>
                      <button type="button" onClick={() => setArmed(`kick:${m.id}`)} title="Remove from group"
                        aria-label={`Remove ${m.display_name} from the group`}
                        className="flex items-center justify-center w-11 h-11 md:w-7 md:h-7 rounded-row text-muted hover:text-danger">
                        <UserMinus size={15} aria-hidden="true" />
                      </button>
                    </span>
                  )
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border-t border-line p-2 space-y-0.5">
        {error && <p role="alert" className="px-2 pb-1 text-meta text-danger">{error}</p>}
        {renaming ? (
          <form onSubmit={saveName} className="px-1 pb-1">
            <input autoFocus value={draftName} onChange={(e) => setDraftName(e.target.value)} maxLength={100}
              placeholder="Leave blank to use names" aria-label="Group name"
              onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setRenaming(false); } }}
              className="w-full rounded-control bg-surface-2 border border-line px-2 py-1.5 text-body text-ink outline-none focus:border-accent" />
            <div className="mt-1.5 flex gap-2">
              <button type="submit" disabled={busy}
                className="rounded-control bg-accent hover:bg-accent-strong text-white text-meta font-medium px-2.5 py-1 disabled:opacity-50">Save</button>
              <button type="button" onClick={() => setRenaming(false)} className="text-meta text-muted hover:text-ink">Cancel</button>
            </div>
          </form>
        ) : (
          <button type="button" className={actionButton} onClick={() => { setDraftName(conv.name ?? ""); setRenaming(true); setError(null); }}>
            <PencilSimple size={16} aria-hidden="true" /> Rename group
          </button>
        )}
        <button type="button" className={actionButton} disabled={full} onClick={() => setAdding(true)}
          title={full ? `Groups can have up to ${MAX_GROUP_SIZE} people` : undefined}>
          <UserPlus size={16} aria-hidden="true" /> {full ? "Group is full" : "Add people"}
        </button>
        {armed === "leave" ? (
          <button type="button" disabled={busy} autoFocus onClick={leave}
            className={`${actionButton} bg-danger/15 text-danger hover:bg-danger/25 hover:text-danger`}>
            <SignOut size={16} aria-hidden="true" /> {conv.members.length === 1 ? "Leave and delete group?" : "Leave group?"}
          </button>
        ) : (
          <button type="button" className={`${actionButton} hover:text-danger`} onClick={() => setArmed("leave")}>
            <SignOut size={16} aria-hidden="true" /> Leave group
          </button>
        )}
      </div>
      {adding && (
        <PeoplePickerDialog mode="add" conversationId={conv.id} memberIds={conv.members.map((m) => m.id)} onClose={() => setAdding(false)} />
      )}
    </aside>
  );
}
