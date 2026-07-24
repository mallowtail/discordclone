"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { validateMessage } from "@/lib/validation";
import { uploadImage } from "@/lib/upload";
import type { Message } from "@/types/db";
import { MentionAutocomplete } from "@/components/messages/MentionAutocomplete";

type Target = { channel_id: string } | { conversation_id: string };

// The active @mention query is the @-word immediately before the caret, if any.
function mentionQueryAt(text: string, caret: number): string | null {
  const before = text.slice(0, caret);
  const m = before.match(/(?:^|\s)@([a-zA-Z0-9_]*)$/);
  return m ? m[1] : null;
}

export function MessageInput({
  target,
  placeholder,
  replyTo,
  replyToName,
  onClearReply,
  addPending,
  removePending,
}: {
  target: Target;
  placeholder: string;
  replyTo?: Message | null;
  replyToName?: string;
  onClearReply?: () => void;
  addPending: (m: Message) => void;
  removePending: (id: string) => void;
}) {
  const supabase = createClient();
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pingAuthor, setPingAuthor] = useState(true);
  const [caret, setCaret] = useState(0);
  const [mentionMatches, setMentionMatches] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mentionQuery = mentionQueryAt(text, caret);
  const acOpen = mentionQuery !== null && mentionMatches.length > 0;

  useEffect(() => {
    setPingAuthor(true);
  }, [replyTo?.id]);

  function replyFields() {
    return replyTo ? { reply_to_id: replyTo.id, mention_author: pingAuthor } : {};
  }

  async function submit() {
    if (uploading) return;
    const v = validateMessage(text);
    if (!v.ok) return setError(v.error);
    setError(null);
    const draft = v.value;
    setText("");
    const id = crypto.randomUUID();
    const optimistic: Message = {
      id,
      author_id: user!.id,
      channel_id: "channel_id" in target ? target.channel_id : null,
      conversation_id: "conversation_id" in target ? target.conversation_id : null,
      content: draft,
      image_url: null,
      file_url: null,
      file_name: null,
      created_at: new Date().toISOString(),
      updated_at: null,
      reply_to_id: replyTo?.id ?? null,
      mention_author: replyTo ? pingAuthor : false,
      pinned: false,
      pinned_at: null,
      pending: true,
    };
    addPending(optimistic);
    const { error: err } = await supabase
      .from("messages")
      .insert({ id, author_id: user!.id, content: draft, ...replyFields(), ...target });
    if (err) {
      removePending(id);
      setText(draft);
      setError("Failed to send — try again");
      return;
    }
    onClearReply?.();
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    submit();
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setUploading(true);
    const result = await uploadImage(file);
    setUploading(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    const content = text.trim();
    setText("");
    const id = crypto.randomUUID();
    const optimistic: Message = {
      id,
      author_id: user!.id,
      channel_id: "channel_id" in target ? target.channel_id : null,
      conversation_id: "conversation_id" in target ? target.conversation_id : null,
      content,
      image_url: result.url,
      file_url: null,
      file_name: null,
      created_at: new Date().toISOString(),
      updated_at: null,
      reply_to_id: replyTo?.id ?? null,
      mention_author: replyTo ? pingAuthor : false,
      pinned: false,
      pinned_at: null,
      pending: true,
    };
    addPending(optimistic);
    const { error: err } = await supabase
      .from("messages")
      .insert({ id, author_id: user!.id, content, image_url: result.url, ...replyFields(), ...target });
    if (err) {
      removePending(id);
      setError("Failed to send image — try again");
      return;
    }
    onClearReply?.();
  }

  function pickMention(username: string) {
    const before = text.slice(0, caret).replace(/@([a-zA-Z0-9_]*)$/, `@${username} `);
    const after = text.slice(caret);
    const next = before + after;
    setText(next);
    setCaret(before.length);
    requestAnimationFrame(() => {
      taRef.current?.focus();
      taRef.current?.setSelectionRange(before.length, before.length);
    });
  }

  return (
    <form onSubmit={send} className="p-3 relative">
      <MentionAutocomplete query={mentionQuery} onPick={pickMention} onResults={setMentionMatches} />
      {error && <p className="text-danger text-sm mb-1">{error}</p>}
      {replyTo && (
        <div className="flex items-center justify-between bg-surface rounded-t-xl px-2 py-1 text-[11px] text-muted">
          <span>
            Replying to <b className="text-ink">{replyToName ?? "user"}</b>
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPingAuthor((p) => !p)}
              className={`rounded-full px-2 font-semibold border ${
                pingAuthor ? "border-accent bg-mention text-mention-ink" : "border-line text-muted"
              }`}
            >
              {pingAuthor ? "@ ON" : "@ OFF"}
            </button>
            <button type="button" onClick={onClearReply} title="Cancel reply" className="hover:text-ink">
              ✕
            </button>
          </span>
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="text-muted hover:text-ink"
          title="Attach image"
        >
          📎
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyUp={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onClick={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onKeyDown={(e) => {
            // While the @-autocomplete is open, Enter/Tab accepts the top match
            // instead of sending the message.
            if (acOpen && (e.key === "Enter" || e.key === "Tab")) {
              e.preventDefault();
              pickMention(mentionMatches[0]);
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={uploading ? "Uploading…" : placeholder}
          className="flex-1 p-2 rounded-2xl border border-line bg-surface text-ink outline-none resize-none"
        />
      </div>
    </form>
  );
}
