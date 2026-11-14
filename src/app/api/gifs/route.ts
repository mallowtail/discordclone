import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { normalizeKlipyItem, type Gif } from "@/lib/messages/gifs";

// GIF search and trending through KLIPY. The API key never leaves the server.
// Content rating PG-13: on KLIPY that's the same set as their loosest setting, and their library is
// human-moderated with nothing explicit in it.
const RATING = "pg-13";
const PER_PAGE = 24;

// The test key allows 100 calls a minute for the whole app, so results are cached (trending briefly,
// searches longer) and each person is limited.
const TRENDING_MS = 5 * 60 * 1000;
const SEARCH_MS = 30 * 60 * 1000;
const CACHE_MAX = 300;
const cache = new Map<string, { at: number; value: { gifs: Gif[]; hasNext: boolean } }>();
const RATE_PER_MIN = 30;
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
  const { data } = await supabase.auth.getUser();
  if (!data.user) return Response.json({ error: "Sign in first" }, { status: 401 });

  const key = process.env.KLIPY_API_KEY;
  if (!key) return Response.json({ error: "GIFs aren't set up yet" }, { status: 503 });

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  const page = Math.min(20, Math.max(1, Number(request.nextUrl.searchParams.get("page")) || 1));
  const cacheKey = `${q.toLowerCase()}|${page}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < (q ? SEARCH_MS : TRENDING_MS)) return Response.json(hit.value);
  if (!allowed(data.user.id)) return Response.json({ error: "Slow down a little" }, { status: 429 });

  // KLIPY asks for a per-user id; send a one-way hash, not the real account id.
  const customer = createHash("sha256").update(`mallowchat:${data.user.id}`).digest("hex").slice(0, 32);
  const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE), customer_id: customer, rating: RATING, locale: "en" });
  if (q) params.set("q", q);
  const endpoint = `https://api.klipy.com/api/v1/${encodeURIComponent(key)}/gifs/${q ? "search" : "trending"}?${params}`;

  try {
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!res.ok) return Response.json({ error: "GIF search is unavailable right now" }, { status: 502 });
    const body = (await res.json()) as { data?: { data?: unknown[]; has_next?: boolean } };
    const gifs = (body.data?.data ?? [])
      .map((i) => normalizeKlipyItem(i as Parameters<typeof normalizeKlipyItem>[0]))
      .filter((g): g is Gif => !!g);
    const value = { gifs, hasNext: !!body.data?.has_next };
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(cacheKey, { at: Date.now(), value });
    return Response.json(value);
  } catch {
    return Response.json({ error: "GIF search is unavailable right now" }, { status: 502 });
  }
}
