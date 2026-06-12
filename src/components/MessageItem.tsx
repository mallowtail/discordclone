"use client";

import { useMemo, useState } from "react";
import type { Message } from "@/types/db";
import { formatTime } from "@/lib/format";
import { useAuth } from "@/components/providers/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import { validateMessage } from "@/lib/validation";
import { mentionsMe } from "@/lib/mentions";
import { MessageContent } from "@/components/MessageContent";
import { MessageActions } from "@/components/MessageActions";
import { ReactionBar } from "@/components/ReactionBar";
import type { ReactionPill } from "@/lib/reactions";

function snippet(m: Message): string {
  if (m.content) return m.content.length > 60 ? m.content.slice(0, 60) + "…" : m.content;
  if (m.image_url) return "📷 image";
  return "";
}

export function MessageItem({
  msg,
  authorName,
  showHeader,
  pills,
  repliedTo,
  repliedToName,
  onReply,
}: {
  msg: Message;
  authorName: string;
  showHeader: boolean;
  pills: ReactionPill[];
  repliedTo: Message | null;
  repliedToName?: string;
  onReply?: (m: Message, authorName: string) => void;
}) {
  const { user, profile } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const isMine = user?.id === msg.author_id;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.content);
  const [error, setError] = useState<string | null>(null);

  const highlighted =
    !isMine &&
    mentionsMe({
      content: msg.content,
      myUsername: profile?.username ?? null,
      myId: user?.id ?? null,
      replyToId: msg.reply_to_id,
      mentionAuthor: msg.mention_author,
      repliedToAuthorId: repliedTo?.author_id ?? null,
    });

  async function saveEdit() {
    const v = validateMessage(draft);
    if (!v.ok && !msg.image_url) return setError(v.error);
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
  }

  function jumpToOriginal() {
    if (repliedTo) document.getElementById(`msg-${repliedTo.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div
      id={`msg-${msg.id}`}
      className={`group relative px-4 hover:bg-black/10 ${showHeader ? "mt-3 pt-0.5" : ""} ${
        highlighted ? "bg-[#faa61a]/10 border-l-2 border-[#faa61a]" : ""
      }`}
    >
      {msg.reply_to_id && (
        <div
          onClick={jumpToOriginal}
          className="flex items-center gap-1 text-[11px] text-[#949ba4] mb-0.5 cursor-pointer"
        >
          <span className="text-[#6d6f78]">↰</span>
          {repliedTo ? (
            <>
              {msg.mention_author ? (
                <span className="bg-[#3c4270] text-[#c9cdfb] rounded px-1 font-medium">@{repliedToName ?? "user"}</span>
              ) : (
                <span className="text-[#c9ccd1] font-semibold">{repliedToName ?? "user"}</span>
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
          <span className="font-semibold text-white">{authorName}</span>
          <span className="text-xs text-[#949ba4] ml-2">{formatTime(msg.created_at)}</span>
          {msg.pinned && <span className="text-xs text-[#949ba4] ml-2" title="Pinned">📌</span>}
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
            className="w-full p-2 rounded bg-[#383a40] text-[#dbdee1] outline-none"
          />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <p className="text-xs text-[#949ba4]">Enter to save · Esc to cancel</p>
        </div>
      ) : (
        <MessageContent msg={msg} />
      )}
      {error && !editing && <p className="text-red-400 text-sm">{error}</p>}

      {!editing && <ReactionBar message={msg} pills={pills} />}
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
