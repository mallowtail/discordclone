import type { NextRequest } from "next/server";
import { RoomServiceClient, TrackType } from "livekit-server-sdk";
import { createServerSupabase } from "@/lib/supabase/server";
import { roomForChannel } from "@/lib/voice/rooms";

export type VoiceOccupant = { id: string; name: string; muted: boolean };

/**
 * Who is in each voice channel of a server (for the sidebar), straight from LiveKit so it can't be
 * faked. Members of the server only.
 */
export async function GET(request: NextRequest) {
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  if (!key || !secret || !url) return Response.json({ rooms: {} });

  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return Response.json({ error: "Sign in first" }, { status: 401 });

  const serverId = request.nextUrl.searchParams.get("server") ?? "";
  // RLS only returns channels of servers the caller can see; voice channels need membership too.
  const { data: member } = await supabase.from("server_members").select("user_id")
    .eq("server_id", serverId).eq("user_id", auth.claims.sub).maybeSingle();
  if (!member) return Response.json({ error: "Not a member" }, { status: 403 });
  const { data: channels } = await supabase.from("channels").select("id").eq("server_id", serverId).eq("kind", "voice");
  if (!channels?.length) return Response.json({ rooms: {} });

  const svc = new RoomServiceClient(url.replace(/^wss:/, "https:"), key, secret);
  const names = channels.map((c) => roomForChannel(c.id));
  const live = await svc.listRooms(names).catch(() => []);
  const rooms: Record<string, VoiceOccupant[]> = {};
  await Promise.all(live.filter((r) => r.numParticipants > 0).map(async (r) => {
    const people = await svc.listParticipants(r.name).catch(() => []);
    rooms[r.name.slice(3)] = people.map((p) => ({
      id: p.identity,
      name: p.name || "Someone",
      muted: !p.tracks.some((t) => t.type === TrackType.AUDIO && !t.muted),
    }));
  }));
  return Response.json({ rooms }, { headers: { "Cache-Control": "no-store" } });
}
