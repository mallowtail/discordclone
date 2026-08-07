"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { validateMessage } from "@/lib/validation";
import { uploadAndPostFile } from "@/lib/sendAttachment";
import type { Message } from "@/types/db";
import { MentionAutocomplete } from "@/components/messages/MentionAutocomplete";
import EmojiPicker, { Theme } from "emoji-picker-react";
import { Plus, Smiley, File } from "@phosphor-icons/react";

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);
  const mentionQuery = mentionQueryAt(text, caret);
  const acOpen = mentionQuery !== null && mentionMatches.length > 0;

  useEffect(() => {
    setPingAuthor(true);
  }, [replyTo?.id]);

  // Close the + menu on outside-click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // Close the emoji picker on outside-click / Escape.
  useEffect(() => {
    if (!emojiOpen) return;
    function onDown(e: MouseEvent) {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) setEmojiOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setEmojiOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [emojiOpen]);

  function replyFields() {
    return replyTo ? { reply_to_id: replyTo.id, mention_author: pingAuthor } : {};
  }

  function resetHeight() {
    if (taRef.current) taRef.current.style.height = "auto";
  }

  async function submit() {
    if (uploading) return;
    const v = validateMessage(text);
    if (!v.ok) return setError(v.error);
    setError(null);
    const draft = v.value;
    setText("");
    resetHeight();
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

  async function handleFile(file: File) {
    if (uploading) return;
    setError(null);
    setUploading(true);
    const content = text.trim();
    const res = await uploadAndPostFile({
      supabase,
      userId: user!.id,
      target,
      file,
      content,
      replyFields: replyFields(),
      addPending,
      removePending,
    });
    setUploading(false);
    if (res.error) return setError(res.error);
    setText("");
    resetHeight();
    onClearReply?.();
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) handleFile(file);
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

  function insertEmoji(emoji: string) {
    const before = text.slice(0, caret);
    const after = text.slice(caret);
    const next = before + emoji + after;
    setText(next);
    const newCaret = before.length + emoji.length;
    setCaret(newCaret);
    requestAnimationFrame(() => {
      taRef.current?.focus();
      taRef.current?.setSelectionRange(newCaret, newCaret);
    });
  }

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 192) + "px";
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
      <div className="relative">
        <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface px-3 py-2">
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              title="Add"
              disabled={uploading}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-2 text-muted hover:text-ink text-lg leading-none disabled:opacity-50"
            >
              <Plus size={18} weight="bold" />
            </button>
            {menuOpen && (
              <div className="absolute bottom-full mb-2 left-0 z-20 w-40 rounded-xl border border-line bg-surface shadow-lg py-1">
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); fileRef.current?.click(); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-ink hover:bg-surface-2 text-left"
                >
                  <File size={16} aria-hidden="true" /> Upload a file
                </button>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="*/*" className="hidden" onChange={onPickFile} />
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setCaret(e.target.selectionStart ?? e.target.value.length);
              autoGrow(e.target);
            }}
            onKeyUp={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
            onClick={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
            onKeyDown={(e) => {
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
            className="flex-1 bg-transparent text-ink outline-none resize-none min-h-[44px] max-h-48 py-2"
          />
          <div className="relative" ref={emojiRef}>
            <button
              type="button"
              onClick={() => setEmojiOpen((o) => !o)}
              title="Emoji"
              className="w-8 h-8 flex items-center justify-center rounded-full text-muted hover:text-ink text-lg leading-none"
            >
              <Smiley size={20} />
            </button>
            {emojiOpen && (
              <div className="absolute bottom-full right-0 mb-2 z-30">
                <EmojiPicker
                  theme={Theme.DARK}
                  onEmojiClick={(d) => insertEmoji(d.emoji)}
                  lazyLoadEmojis
                  skinTonesDisabled
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
