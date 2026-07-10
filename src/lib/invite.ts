/** Build the shareable invite URL for a code. Falls back to the current origin in the browser. */
export function inviteUrl(code: string, origin?: string): string {
  const base = (origin ?? (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/$/, "");
  return `${base}/invite/${code}`;
}
