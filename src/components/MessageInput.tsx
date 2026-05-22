"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { validateMessage } from "@/lib/validation";

type Target = { channel_id: string } | { conversation_id: string };

export function MessageInput({ target, placeholder }: { target: Target; placeholder: string }) {
  const supabase = createClient();
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const v = validateMessage(text);
    if (!v.ok) return setError(v.error);
    setError(null);
    const draft = v.value;
    setText(""); // optimistic clear
    const { error: err } = await supabase
      .from("messages")
      .insert({ author_id: user!.id, content: draft, ...target });
    if (err) {
      setText(draft); // restore so the user can retry
      setError("Failed to send — try again");
    }
  }

  return (
    <form onSubmit={send} className="p-3">
      {error && <p className="text-red-400 text-sm mb-1">{error}</p>}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        className="w-full p-2 rounded bg-[#383a40] text-[#dbdee1] outline-none"
      />
    </form>
  );
}
