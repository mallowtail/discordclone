import type { NextRequest } from "next/server";
import { AccessToken, TrackSource } from "livekit-server-sdk";
import { createServerSupabase } from "@/lib/supabase/server";
import { parseRoom } from "@/lib/voice/rooms";

/**
 * A short-lived LiveKit token for one voice room, issued only after checking (as the signed-in
 * user, so the database's own rules apply) that they may be there:
 *   - voice channel: a member of its server; timed-out members may listen but not speak;
 *   - DM / group call: a member of the conversation; 1:1 DMs also honour blocks and DM settings.
 * The API secret never leaves the server.
 */
export async function POST(request: NextRequest) {
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!key || !secret) return Response.json({ error: "Voice isn't set up yet" }, { status: 503 });

  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return Response.json({ error: "Sign in first" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { room?: string };
  const ref = parseRoom(body.room ?? "");
  if (!ref) return Response.json({ error: "Unknown room" }, { status: 400 });

  let canSpeak = true;
  if (ref.type === "channel") {
    const { data: channel } = await supabase.from("channels").select("id, server_id, kind").eq("id", ref.id).maybeSingle();
    if (!channel || channel.kind !== "voice") return Response.json({ error: "Not a voice channel" }, { status: 404 });
    const { data: member } = await supabase.from("server_members").select("timeout_until")
      .eq("server_id", channel.server_id).eq("user_id", userId).maybeSingle();
    if (!member) return Response.json({ error: "You're not in this server" }, { status: 403 });
    canSpeak = !member.timeout_until || new Date(member.timeout_until) <= new Date();
  } else {
    const { data: conv } = await supabase.from("conversations").select("id, is_group").eq("id", ref.id).maybeSingle();
    if (!conv) return Response.json({ error: "Conversation not found" }, { status: 404 });
    if (!conv.is_group) {
      const { data: allowed } = await supabase.rpc("dm_send_allowed", { conv: ref.id });
      if (!allowed) return Response.json({ error: "You can't call this person" }, { status: 403 });
    }
  }

  const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle();
  const token = new AccessToken(key, secret, { identity: userId, name: profile?.display_name ?? "Someone", ttl: "6h" });
  token.addGrant({
    roomJoin: true,
    room: body.room,
    canSubscribe: true,
    canPublish: canSpeak,
    canPublishData: false,
    canPublishSources: [TrackSource.MICROPHONE], // screen sharing comes later
  });
  return Response.json({ token: await token.toJwt(), canSpeak }, { headers: { "Cache-Control": "no-store" } });
}
