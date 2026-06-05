"use client";

import { useMemo, useState } from "react";
import type { Message } from "@/types/db";
import { formatTime } from "@/lib/format";
import { useAuth } from "@/components/providers/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import { validateMessage } from "@/lib/validation";
import { MessageContent } from "@/components/MessageContent";
import { MessageActions } from "@/components/MessageActions";

export function MessageItem({
  msg,
  authorName,
  showHeader,
}: {
  msg: Message;
  authorName: string;
  showHeader: boolean;
}) {
  const { user } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const isMine = user?.id === msg.author_id;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.content);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className={`group relative px-4 hover:bg-black/10 ${showHeader ? "mt-3 pt-0.5" : ""}`}>
      {showHeader && (
        <div>
          <span className="font-semibold text-white">{authorName}</span>
          <span className="text-xs text-[#949ba4] ml-2">{formatTime(msg.created_at)}</span>
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
      {isMine && !editing && (
        <MessageActions
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
