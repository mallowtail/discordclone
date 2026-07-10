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
