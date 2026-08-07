"use client";

import { useMemo, useState } from "react";
import type { Message } from "@/types/db";
import { formatTime } from "@/lib/format";
import { useAuth } from "@/components/providers/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import { validateMessage } from "@/lib/validation";
import { mentionsMe } from "@/lib/mentions";
import { MessageContent } from "@/components/messages/MessageContent";
import { MessageActions } from "@/components/messages/MessageActions";
import { ReactionBar } from "@/components/messages/ReactionBar";
import { Avatar } from "@/components/user/Avatar";
import { useProfilePopover } from "@/components/providers/ProfilePopoverProvider";
import type { ReactionPill } from "@/lib/reactions";
import { ArrowBendUpLeft, PushPin } from "@phosphor-icons/react";

function snippet(m: Message): string {
  if (m.content) return m.content.length > 60 ? m.content.slice(0, 60) + "…" : m.content;
  if (m.image_url) return "Image";
  if (m.file_url) return "File";
  return "";
}

export function MessageItem({
  msg,
  authorName,
  authorAvatar,
  showHeader,
  pills,
  repliedTo,
  repliedToName,
  onReply,
  serverId,
  authorColor,
}: {
  msg: Message;
  authorName: string;
  authorAvatar: string | null;
  showHeader: boolean;
  pills: ReactionPill[];
  repliedTo: Message | null;
  repliedToName?: string;
  onReply?: (m: Message, authorName: string) => void;
  serverId?: string;
  authorColor?: string | null;
}) {
  const { user, profile } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const { open } = useProfilePopover();
  const isMine = user?.id === msg.author_id;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.content);
  const [error, setError] = useState<string | null>(null);

  const highlighted = mentionsMe({
    content: msg.content,
    myUsername: profile?.username ?? null,
    myId: user?.id ?? null,
    replyToId: msg.reply_to_id,
    mentionAuthor: msg.mention_author,
    repliedToAuthorId: repliedTo?.author_id ?? null,
  });

  async function saveEdit() {
    const v = validateMessage(draft);
    if (!v.ok && !msg.image_url && !msg.file_url) return setError(v.error);
    const newContent = v.ok ? v.value : "";
    const { error: err } = await supabase
      .from("messages")
      .update({ content: newContent, updated_at: new Date().toISOString() })
      .eq("id", msg.id);
    if (err) return setError("Couldn't save — try again");
    setEditing(false);
    setError(null);
  }

  async function remove() {
    if (!confirm("Delete this message?")) return;
    const { error: err } = await supabase.from("messages").delete().eq("id", msg.id);
    if (err) setError("Couldn't delete — try again");
  }

  async function togglePin() {
    const { error: err } = await supabase.rpc("toggle_pin", { msg: msg.id });
    if (err) setError("Couldn't pin — try again");
    else setError(null);
  }

  function jumpToOriginal() {
    if (repliedTo) document.getElementById(`msg-${repliedTo.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function openProfile(e: React.MouseEvent<HTMLElement>) {
    open(msg.author_id, e.currentTarget.getBoundingClientRect(), serverId);
  }

  return (
    <div
      id={`msg-${msg.id}`}
      className={`group relative px-4 hover:bg-black/10 ${showHeader ? "mt-3 pt-0.5" : ""} ${
        highlighted ? "bg-amber/10 border-l-2 border-amber" : ""
      } ${msg.pending ? "opacity-50" : ""}`}
    >
      {!showHeader && msg.pinned && (
        <span className="absolute left-1 top-0.5 text-muted" title="Pinned" aria-label="Pinned">
          <PushPin size={15} weight="fill" />
        </span>
      )}
      <div className="flex gap-3">
        <div className="w-10 flex-none">
          {showHeader && (
            <button onClick={openProfile} className="hover:opacity-80" aria-label={`View ${authorName}'s profile`}>
              <Avatar url={authorAvatar} name={authorName} size="md" />
            </button>
          )}
        </div>
        <div className="flex-1 min-w-0">
          {msg.reply_to_id && (
            <div
              onClick={jumpToOriginal}
              className="flex items-center gap-1 text-[11px] text-muted mb-0.5 cursor-pointer"
            >
              <span className="text-muted"><ArrowBendUpLeft size={14} weight="bold" /></span>
              {repliedTo ? (
                <>
                  {msg.mention_author ? (
                    <span className="bg-mention text-mention-ink rounded px-1 font-medium">@{repliedToName ?? "user"}</span>
                  ) : (
                    <span className="text-ink font-semibold">{repliedToName ?? "user"}</span>
                  )}
                  <span className="truncate">{snippet(repliedTo)}</span>
                </>
              ) : (
                <span className="italic">Original message</span>
              )}
            </div>
          )}

          {showHeader && (
            <div>
              <button onClick={openProfile} className="font-semibold text-ink hover:underline" style={{ color: authorColor ?? undefined }}>{authorName}</button>
              <span className="text-xs text-muted ml-2">{formatTime(msg.created_at)}</span>
              {msg.pinned && (
                <span className="text-muted ml-2 inline-flex align-middle" title="Pinned" aria-label="Pinned">
                  <PushPin size={15} weight="fill" />
                </span>
              )}
            </div>
          )}

          {editing ? (
            <div>
              <textarea
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    saveEdit();
                  }
                  if (e.key === "Escape") {
                    setEditing(false);
                    setDraft(msg.content);
                    setError(null);
                  }
                }}
                className="w-full p-2 rounded-xl bg-surface text-ink outline-none"
              />
              {error && <p className="text-danger text-sm">{error}</p>}
              <p className="text-xs text-muted">Enter to save · Esc to cancel</p>
            </div>
          ) : (
            <MessageContent msg={msg} />
          )}
          {error && !editing && <p className="text-danger text-sm">{error}</p>}

          {!editing && <ReactionBar message={msg} pills={pills} />}
        </div>
      </div>
      {!editing && (
        <MessageActions
          onReply={() => onReply?.(msg, authorName)}
          onPin={togglePin}
          pinned={msg.pinned}
          canEdit={isMine}
          onEdit={() => {
            setDraft(msg.content);
            setEditing(true);
          }}
          onDelete={remove}
        />
      )}
    </div>
  );
}
