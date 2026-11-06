import { DISPLAY_MAX } from "@/lib/profile";
import { isHttpUrl } from "@/lib/url";

/** Supabase `user.user_metadata` as filled in by an OAuth provider (Google, GitHub, Discord). */
type Meta = Record<string, unknown> | null | undefined;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * A username suggestion for the first-sign-in step, or "" when the provider gave us nothing that
 * survives our username rules (3-20 of A-Z a-z 0-9 _). Never trusted as-is: the user can edit it,
 * and the insert still goes through validateUsername and the unique constraint.
 */
export function suggestUsername(meta: Meta): string {
  const email = str(meta?.email);
  const candidates = [
    str(meta?.user_name), // GitHub
    str(meta?.preferred_username),
    str(meta?.name),
    str(meta?.full_name), // Discord's username lives here
    email.includes("@") ? email.slice(0, email.indexOf("@")) : "",
  ];
  for (const c of candidates) {
    const cleaned = c.replace(/[^A-Za-z0-9_]/g, "").slice(0, 20);
    if (cleaned.length >= 3) return cleaned;
  }
  return "";
}

/** The human-readable name to show, capped to the display-name limit. */
export function displayNameFrom(meta: Meta, fallback: string): string {
  const claims = meta?.custom_claims as Record<string, unknown> | undefined;
  const candidates = [
    str(claims?.global_name), // Discord's display name
    str(meta?.full_name),
    str(meta?.name),
    str(meta?.user_name),
  ];
  const found = candidates.find((c) => c.length > 0);
  return (found ?? fallback).slice(0, DISPLAY_MAX);
}

/** The provider's profile picture, if it's a plain http(s) URL. */
export function avatarFrom(meta: Meta): string | null {
  const url = str(meta?.avatar_url) || str(meta?.picture);
  return url && isHttpUrl(url) ? url : null;
}
