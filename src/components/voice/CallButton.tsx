"use client";

import { useState } from "react";
import { useVoice } from "@/components/providers/VoiceProvider";
import { useActiveCall } from "@/hooks/useActiveCall";
import { roomForConversation } from "@/lib/voice/rooms";
import { Phone, PhoneCall } from "@phosphor-icons/react";

/** The phone button in a DM / group header: Start call, Join call (one's going), or In call. */
export function CallButton({ conversationId, label, disabled }: { conversationId: string; label: string; disabled?: boolean }) {
  const voice = useVoice();
  const call = useActiveCall(conversationId);
  const [error, setError] = useState<string | null>(null);
  const room = roomForConversation(conversationId);
  const here = voice.room === room && voice.status !== "idle";

  async function start() {
    setError(null);
    // Through the server, which first clears out a call everyone left by closing the tab.
    const res = await fetch("/api/voice/call", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversation: conversationId, action: "start" }),
    }).catch(() => null);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
      return setError(body?.error ?? "Couldn't start the call — try again.");
    }
    await voice.join(room, label, `/dms/${conversationId}`);
  }

  const base = "flex items-center gap-1.5 rounded-control px-2.5 min-h-11 md:min-h-8 text-meta font-medium disabled:opacity-50";
  return (
    <div className="relative flex items-center">
      {here ? (
        <span className={`${base} text-online`} role="status"><PhoneCall size={16} weight="fill" aria-hidden="true" /> In call</span>
      ) : call ? (
        <button type="button" onClick={start} disabled={disabled || voice.status === "connecting"}
          className={`${base} bg-online/90 text-app hover:bg-online`}>
          <PhoneCall size={16} weight="fill" aria-hidden="true" /> Join call
        </button>
      ) : (
        <button type="button" onClick={start} disabled={disabled || voice.status === "connecting"} title="Start a voice call" aria-label="Start a voice call"
          className={`${base} text-muted hover:text-ink hover:bg-surface-2`}>
          <Phone size={18} weight="bold" aria-hidden="true" />
        </button>
      )}
      {error && <p role="alert" className="absolute right-0 top-full mt-1 w-56 rounded-control bg-surface border border-line px-2 py-1 text-micro text-danger z-20">{error}</p>}
    </div>
  );
}
