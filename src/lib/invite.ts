/** Build the shareable invite URL for a code. Falls back to the current origin in the browser. */
export function inviteUrl(code: string, origin?: string): string {
  const base = (origin ?? (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/$/, "");
  return `${base}/invite/${code}`;
}

/** Only allow same-origin relative redirect targets; otherwise fall back to the app home. */
export function safeNext(raw: string | null): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\")) return raw;
  return "/channels/first";
}

/** Extract an invite code from a pasted full invite URL or a bare code. Returns null if empty. */
export function parseInviteCode(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const marker = "/invite/";
  const idx = trimmed.lastIndexOf(marker);
  const raw = idx >= 0 ? trimmed.slice(idx + marker.length) : trimmed;
  const code = raw.split(/[/?#\s]/)[0];
  return code || null;
}

/** "Expire after" choices for a new invite, Discord-style. `null` means it never expires. */
export const EXPIRY_OPTIONS = [
  { label: "30 minutes", seconds: 1800 },
  { label: "1 hour", seconds: 3600 },
  { label: "6 hours", seconds: 21600 },
  { label: "12 hours", seconds: 43200 },
  { label: "1 day", seconds: 86400 },
  { label: "7 days", seconds: 604800 },
  { label: "Never", seconds: null },
] as const;
export const DEFAULT_EXPIRY_SECONDS = 604800;

/** "Max uses" choices. `null` is unlimited; 1 makes a one-time link. */
export const MAX_USES_OPTIONS = [
  { label: "No limit", uses: null },
  { label: "1 use", uses: 1 },
  { label: "5 uses", uses: 5 },
  { label: "10 uses", uses: 10 },
  { label: "25 uses", uses: 25 },
  { label: "50 uses", uses: 50 },
  { label: "100 uses", uses: 100 },
] as const;

/**
 * A server owner's custom invite link text. Capitals are allowed for display, but codes match
 * case-insensitively when joining (the database enforces uniqueness on lower(code)). Mirrors the
 * check in set_vanity_invite and the invites.code constraint.
 */
export function validateVanityCode(
  input: string
): { ok: true; value: string } | { ok: false; error: string } {
  const value = input.trim();
  if (!/^[A-Za-z0-9-]{2,32}$/.test(value)) {
    return { ok: false, error: "2–32 letters, numbers, or hyphens" };
  }
  return { ok: true, value };
}

export type InviteStatus = "ok" | "expired" | "used_up";

/** Whether an invite can still be used. Mirrors the checks in join_via_invite / server_by_invite. */
export function inviteStatus(
  inv: { expires_at: string | null; max_uses: number | null; uses: number },
  now: Date = new Date()
): InviteStatus {
  if (inv.expires_at && new Date(inv.expires_at).getTime() <= now.getTime()) return "expired";
  if (inv.max_uses !== null && inv.uses >= inv.max_uses) return "used_up";
  return "ok";
}

/** Short "time left" label for the managers' invite list: Never · 45m · 5h · 3d · Expired. */
export function formatTimeLeft(expiresAt: string | null, now: Date = new Date()): string {
  if (!expiresAt) return "Never";
  const ms = new Date(expiresAt).getTime() - now.getTime();
  if (ms <= 0) return "Expired";
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}
