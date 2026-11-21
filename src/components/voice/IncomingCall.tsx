"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { useVoice } from "@/components/providers/VoiceProvider";
import { useSafety } from "@/components/providers/SafetyProvider";
import { CONVERSATION_SELECT, summarizeConversation, type ConversationRow } from "@/lib/users/conversations";
import { roomForConversation } from "@/lib/voice/rooms";
import { Avatar } from "@/components/user/profile/Avatar";
import { GroupIcon } from "@/components/dms/groups/GroupIcon";
import { Phone, PhoneSlash } from "@phosphor-icons/react";

type Ringing = { callId: string; conversationId: string; label: string; callerId: string; callerName: string; isGroup: boolean };

const RING_MS = 30_000;

/** A soft two-tone ring, repeated every 2 seconds while the pop-up is up. Returns a stop function. */
function startRinging(): () => void {
  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioContext();
  } catch {
    return () => {};
  }
  const beep = () => {
    if (!ctx) return;
    for (const [freq, at] of [[660, 0], [880, 0.18]] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.17);
    }
  };
  beep();
  const t = setInterval(beep, 2000);
  return () => {
    clearInterval(t);
    void ctx?.close();
    ctx = null;
  };
}

/**
 * "Sam is calling — Join / Decline". Listens for calls starting in your DMs and groups (the
 * database only sends you calls in conversations you're in), skips ones you started, ones from
 * people you've blocked or ignored, and ones you're already in. Rings for 30 seconds at most.
 */
export function IncomingCall() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { user } = useAuth();
  const voice = useVoice();
  const { kindOf } = useSafety();
  const instanceId = useId();
  const [ringing, setRinging] = useState<Ringing | null>(null);
  const stopRef = useRef<() => void>(() => {});

  const dismiss = useCallback(() => {
    stopRef.current();
    stopRef.current = () => {};
    setRinging(null);
  }, []);

  // Keep the latest values for the realtime handler without resubscribing on every change.
  const latest = useRef({ voiceRoom: voice.room, kindOf });
  useEffect(() => { latest.current = { voiceRoom: voice.room, kindOf }; });

  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel(`incoming-calls:${user.id}:${instanceId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "calls" }, async (payload) => {
        const call = payload.new as { id: string; conversation_id: string; started_by: string | null; started_at: string };
        if (!call.started_by || call.started_by === user.id) return;
        if (Date.now() - new Date(call.started_at).getTime() > RING_MS) return;
        if (latest.current.kindOf(call.started_by)) return; // blocked or ignored
        if (latest.current.voiceRoom === roomForConversation(call.conversation_id)) return;
        const { data } = await supabase.from("conversations").select(CONVERSATION_SELECT).eq("id", call.conversation_id).maybeSingle();
        if (!data) return;
        const conv = summarizeConversation(data as unknown as ConversationRow, user.id);
        const caller = conv.members.find((m) => m.id === call.started_by);
        stopRef.current();
        stopRef.current = startRinging();
        setRinging({
          callId: call.id, conversationId: conv.id, label: conv.label, isGroup: conv.isGroup,
          callerId: call.started_by, callerName: caller?.display_name ?? "Someone",
        });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "calls" }, (payload) => {
        const call = payload.new as { id: string; ended_at: string | null };
        if (call.ended_at) setRinging((r) => (r && r.callId === call.id ? (stopRef.current(), null) : r));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supabase, user, instanceId]);

  // Stop after 30 seconds, and if you end up in that call some other way.
  useEffect(() => {
    if (!ringing) return;
    const t = setTimeout(dismiss, RING_MS);
    return () => clearTimeout(t);
  }, [ringing, dismiss]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- joined the call elsewhere: stop ringing
    if (ringing && voice.room === roomForConversation(ringing.conversationId)) dismiss();
  }, [ringing, voice.room, dismiss]);
  useEffect(() => () => stopRef.current(), []);

  if (!ringing) return null;

  async function join() {
    if (!ringing) return;
    const r = ringing;
    dismiss();
    router.push(`/dms/${r.conversationId}`);
    await voice.join(roomForConversation(r.conversationId), r.label, `/dms/${r.conversationId}`);
  }

  return (
    <div role="alertdialog" aria-label={`Incoming call from ${ringing.callerName}`}
      className="fixed bottom-4 right-4 z-[70] w-72 rounded-card border border-line bg-surface p-4 shadow-2xl">
      <div className="flex items-center gap-3">
        {ringing.isGroup ? <GroupIcon size="md" /> : <Avatar url={null} name={ringing.callerName} seed={ringing.callerId} size="md" />}
        <div className="min-w-0">
          <div className="truncate text-body font-semibold text-ink">{ringing.isGroup ? ringing.label : ringing.callerName}</div>
          <div className="text-meta text-muted">{ringing.isGroup ? `${ringing.callerName} started a call` : "is calling you…"}</div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" onClick={dismiss}
          className="flex items-center justify-center gap-1.5 rounded-control bg-danger/90 hover:bg-danger py-2 text-body font-medium text-white min-h-11 md:min-h-0">
          <PhoneSlash size={16} weight="fill" aria-hidden="true" /> Decline
        </button>
        <button type="button" onClick={join}
          className="flex items-center justify-center gap-1.5 rounded-control bg-online/90 hover:bg-online py-2 text-body font-medium text-app min-h-11 md:min-h-0">
          <Phone size={16} weight="fill" aria-hidden="true" /> Join
        </button>
      </div>
    </div>
  );
}
