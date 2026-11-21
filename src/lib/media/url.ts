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

/**
 * The file name inside `bucket` for one of this app's public Storage URLs
 * (`…/storage/v1/object/public/<bucket>/<name>`), or null for anything else (an outside avatar
 * from Discord/GitHub, another bucket, a nested path). Used to remove a file before its owner goes.
 */
export function storagePathFromPublicUrl(url: string | null | undefined, bucket: string): string | null {
  if (!url) return null;
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  const prefix = `/storage/v1/object/public/${bucket}/`;
  if (!path.startsWith(prefix)) return null;
  const name = path.slice(prefix.length);
  return /^[A-Za-z0-9_-]+(\.[A-Za-z0-9]+)?$/.test(name) ? name : null;
}
