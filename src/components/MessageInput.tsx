"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { validateMessage } from "@/lib/validation";
import { uploadImage } from "@/lib/upload";

type Target = { channel_id: string } | { conversation_id: string };

export function MessageInput({ target, placeholder }: { target: Target; placeholder: string }) {
  const supabase = createClient();
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function submit() {
    if (uploading) return;
    const v = validateMessage(text);
    if (!v.ok) return setError(v.error);
    setError(null);
    const draft = v.value;
    setText(""); // optimistic clear
    const { error: err } = await supabase
      .from("messages")
      .insert({ author_id: user!.id, content: draft, ...target });
    if (err) {
      setText(draft);
      setError("Failed to send — try again");
    }
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    submit();
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be picked again later
    if (!file) return;
    setError(null);
    setUploading(true);
    const result = await uploadImage(file);
    setUploading(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    const content = text.trim(); // optional caption
    setText("");
    const { error: err } = await supabase
      .from("messages")
      .insert({ author_id: user!.id, content, image_url: result.url, ...target });
    if (err) setError("Failed to send image — try again");
  }

  return (
    <form onSubmit={send} className="p-3">
      {error && <p className="text-red-400 text-sm mb-1">{error}</p>}
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
            // Enter sends; Shift+Enter inserts a newline.
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
