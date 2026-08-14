/** True only for http(s) URLs — gate user-supplied URL columns before rendering. */
export function isHttpUrl(url: string): boolean {
  try {
    const proto = new URL(url).protocol;
    return proto === "http:" || proto === "https:";
  } catch {
    return false;
  }
}

/** Append Supabase Storage's ?download=<name> param so the file downloads under its
 *  original name (works cross-origin, unlike the bare `download` attribute). */
export function withDownloadName(url: string, name: string | null): string {
  if (!name) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}download=${encodeURIComponent(name)}`;
}
