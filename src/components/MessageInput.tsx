"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { validateMessage } from "@/lib/validation";
import { uploadImage } from "@/lib/upload";
import type { Message } from "@/types/db";

type Target = { channel_id: string } | { conversation_id: string };

export function MessageInput({
  target,
  placeholder,
  replyTo,
  replyToName,
  onClearReply,
}: {
  target: Target;
  placeholder: string;
  replyTo?: Message | null;
  replyToName?: string;
  onClearReply?: () => void;
}) {
  const supabase = createClient();
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pingAuthor, setPingAuthor] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  // Default the ping back ON each time a new reply target is chosen.
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
    const { error: err } = await supabase
      .from("messages")
      .insert({ author_id: user!.id, content: draft, ...replyFields(), ...target });
    if (err) {
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
    const { error: err } = await supabase
      .from("messages")
      .insert({ author_id: user!.id, content, image_url: result.url, ...replyFields(), ...target });
    if (err) {
      setError("Failed to send image — try again");
      return;
    }
    onClearReply?.();
  }

  return (
    <form onSubmit={send} className="p-3">
      {error && <p className="text-red-400 text-sm mb-1">{error}</p>}
      {replyTo && (
        <div className="flex items-center justify-between bg-[#2b2d31] rounded-t-md px-2 py-1 text-[11px] text-[#949ba4]">
          <span>
            Replying to <b className="text-[#c9ccd1]">{replyToName ?? "user"}</b>
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPingAuthor((p) => !p)}
              className={`rounded-full px-2 font-semibold border ${
                pingAuthor ? "border-[#5865f2] bg-[#3c4270] text-[#c9cdfb]" : "border-[#4e5058] text-[#949ba4]"
              }`}
            >
              {pingAuthor ? "@ ON" : "@ OFF"}
            </button>
            <button type="button" onClick={onClearReply} title="Cancel reply" className="hover:text-white">
              ✕
            </button>
          </span>
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="text-[#949ba4] hover:text-white"
          title="Attach image"
        >
          📎
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={uploading ? "Uploading…" : placeholder}
          className="flex-1 p-2 rounded bg-[#383a40] text-[#dbdee1] outline-none resize-none"
        />
      </div>
    </form>
  );
}
