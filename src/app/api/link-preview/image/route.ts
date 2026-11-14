import type { NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { isAllowedThumbnailHost } from "@/lib/server/linkMeta";
import { safeFetch } from "@/lib/server/safeFetch";

const MAX_BYTES = 3 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];

/**
 * Relays a video/music thumbnail so viewers' browsers never contact the third-party site (which
 * would see their IP address) until they choose to press play. Only the providers' own image
 * hosts, only images, signed-in users only.
 */
export async function GET(request: NextRequest) {
  const supabase = await createServerSupabase();
  // Signature checked locally (no round trip to Supabase Auth per preview / thumbnail).
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return new Response("Sign in first", { status: 401 });

  const src = request.nextUrl.searchParams.get("src") ?? "";
  if (!isAllowedThumbnailHost(src)) return new Response("Not allowed", { status: 400 });

  try {
    const res = await safeFetch(src, { accept: "image/*", maxBytes: MAX_BYTES, timeoutMs: 6000 });
    const type = res.contentType.split(";")[0].trim();
    if (res.status >= 400 || !IMAGE_TYPES.includes(type) || res.body.length >= MAX_BYTES) {
      return new Response("Unavailable", { status: 502 });
    }
    return new Response(new Uint8Array(res.body), {
      headers: {
        "Content-Type": type,
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
      },
    });
  } catch {
    return new Response("Unavailable", { status: 502 });
  }
}
