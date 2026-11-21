import type { NextRequest } from "next/server";
import { RoomServiceClient } from "livekit-server-sdk";
import { createServerSupabase } from "@/lib/supabase/server";
import { parseRoom, roomForConversation } from "@/lib/voice/rooms";
import { isStaleCall } from "@/lib/voice/calls";

/** How many people are in a DM / group call's voice room; null if LiveKit couldn't be asked. */
async function occupants(conversationId: string): Promise<number | null> {
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  if (!key || !secret || !url) return null;
  try {
    const svc = new RoomServiceClient(url.replace(/^wss:/, "https:"), key, secret);
    const [room] = await svc.listRooms([roomForConversation(conversationId)]);
    return room?.numParticipants ?? 0; // no room = nobody there
  } catch {
    return null;
  }
}

/**
 * DM / group calls, checked against who is really connected (LiveKit), not just the database:
 * a call everyone left by closing the tab is marked over here, so it doesn't block new calls
 * (which wouldn't ring) or show "Join call" for an empty room.
 *   POST {conversation, action: "check"} → {active}
 *   POST {conversation, action: "start"} → starts (or joins) the call
 * Runs as the signed-in user, so the database's own membership and DM rules apply.
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return Response.json({ error: "Sign in first" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { conversation?: string; action?: string };
  const conv = parseRoom(roomForConversation(String(body.conversation ?? "")))?.id;
  if (!conv || (body.action !== "check" && body.action !== "start")) return Response.json({ error: "Bad request" }, { status: 400 });

  // RLS: only members see the conversation's calls.
  const { data: call } = await supabase.from("calls").select("started_at")
    .eq("conversation_id", conv).is("ended_at", null).limit(1).maybeSingle();
  let active = !!call;
  if (call && isStaleCall(call.started_at, await occupants(conv))) {
    await supabase.rpc("end_call", { conv });
    active = false;
  }

  if (body.action === "check") return Response.json({ active }, { headers: { "Cache-Control": "no-store" } });

  const { error } = await supabase.rpc("start_call", { conv });
  if (error) {
    const cannot = error.message.includes("cannot call");
    return Response.json({ error: cannot ? "You can't call this person." : "Couldn't start the call — try again." }, { status: cannot ? 403 : 400 });
  }
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
