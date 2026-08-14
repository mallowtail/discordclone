/** True only for http(s) URLs — gate user-supplied URL columns before rendering. */
export function isHttpUrl(url: string): boolean {
  try {
    const proto = new URL(url).protocol;
    return proto === "http:" || proto === "https:";
  } catch {
    return false;
  }
}
