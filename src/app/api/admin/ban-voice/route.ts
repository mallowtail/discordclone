import type { NextRequest } from "next/server";
import { RoomServiceClient } from "livekit-server-sdk";
import { createServerSupabase } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * After a site-wide ban: drop the banned person from every voice room they're connected to
 * (voice channels and DM / group calls), so a ban takes effect at once (spec call 3).
 *   POST {user} → {removed: number of rooms}
 * Only the site admin: checked as the caller themself (their own session and `is_site_admin()`),
 * never with a service key. The LiveKit secret never leaves the server.
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return Response.json({ error: "Sign in first" }, { status: 401 });
  const { data: admin } = await supabase.rpc("is_site_admin");
  if (admin !== true) return Response.json({ error: "Not permitted" }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { user?: unknown };
  const target = typeof body.user === "string" ? body.user : "";
  if (!UUID.test(target)) return Response.json({ error: "Bad request" }, { status: 400 });
  // Only for someone who really is banned now: this route is the ban's voice step, not a kick tool.
  const { data: profile } = await supabase.from("profiles").select("banned_at").eq("id", target).maybeSingle();
  if (!profile?.banned_at) return Response.json({ error: "They aren't banned" }, { status: 409 });

  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  if (!key || !secret || !url) return Response.json({ removed: 0 }, { headers: { "Cache-Control": "no-store" } });

  const svc = new RoomServiceClient(url.replace(/^wss:/, "https:"), key, secret);
  try {
    const rooms = (await svc.listRooms()).filter((r) => r.numParticipants > 0);
    let removed = 0;
    await Promise.all(rooms.map(async (r) => {
      const people = await svc.listParticipants(r.name);
      if (!people.some((p) => p.identity === target)) return;
      await svc.removeParticipant(r.name, target);
      removed++;
    }));
    return Response.json({ removed }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Couldn't reach the voice service" }, { status: 502 });
  }
}
