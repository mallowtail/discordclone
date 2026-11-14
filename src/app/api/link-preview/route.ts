import type { NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { buildLinkPreview, type LinkPreview } from "@/lib/server/linkPreview";

// Per-instance memory cache: the same link in a busy channel is fetched once, not once per viewer.
const CACHE_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 300;
const cache = new Map<string, { at: number; value: LinkPreview | null }>();

// Signed-in users only, and at most 60 lookups a minute each, so this can't be used as a free
// page-fetching service.
const RATE_PER_MIN = 60;
const rate = new Map<string, { start: number; count: number }>();

function allowed(userId: string): boolean {
  const now = Date.now();
  const r = rate.get(userId);
  if (!r || now - r.start > 60_000) {
    rate.set(userId, { start: now, count: 1 });
    return true;
  }
  r.count += 1;
  return r.count <= RATE_PER_MIN;
}

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabase();
  // Signature checked locally (no round trip to Supabase Auth per preview / thumbnail).
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return Response.json({ error: "Sign in first" }, { status: 401 });

  const url = request.nextUrl.searchParams.get("url") ?? "";
  if (url.length > 2048 || !/^https?:\/\//i.test(url)) return Response.json({ error: "Bad link" }, { status: 400 });

  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return reply(hit.value);
  if (!allowed(userId)) return Response.json({ error: "Too many previews" }, { status: 429 });

  const value = await buildLinkPreview(url).catch(() => null);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(url, { at: Date.now(), value });
  return reply(value);
}

function reply(preview: LinkPreview | null) {
  return Response.json({ preview }, { headers: { "Cache-Control": "private, max-age=3600" } });
}
