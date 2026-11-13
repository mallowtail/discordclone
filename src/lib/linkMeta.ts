// Pure helpers for the link-preview server route: reading a page's title/description, and the
// address checks that keep the server from being pointed at private networks.

import net from "node:net";

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 300;

export type PageMeta = { title: string | null; description: string | null; siteName: string | null; image: string | null };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function clean(s: string | undefined, max: number): string | null {
  if (!s) return null;
  const t = decodeEntities(s).replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** The content of `<meta property|name="key" content="…">`, attributes in either order. */
function metaContent(html: string, key: string): string | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1];
    if (name?.toLowerCase() !== key) continue;
    const content = tag.match(/\bcontent\s*=\s*"([^"]*)"/i)?.[1] ?? tag.match(/\bcontent\s*=\s*'([^']*)'/i)?.[1];
    if (content !== undefined) return content;
  }
  return undefined;
}

export function parseHtmlMeta(html: string): PageMeta {
  const head = html.slice(0, 300_000);
  return {
    title: clean(metaContent(head, "og:title") ?? metaContent(head, "twitter:title") ?? head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1], TITLE_MAX),
    description: clean(metaContent(head, "og:description") ?? metaContent(head, "description") ?? metaContent(head, "twitter:description"), DESCRIPTION_MAX),
    siteName: clean(metaContent(head, "og:site_name"), 80),
    image: clean(metaContent(head, "og:image"), 2000),
  };
}

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => acc * 256 + Number(octet), 0);
}

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

/** True for any address the server must never fetch: loopback, private, link-local (incl. cloud
 *  metadata at 169.254.169.254), carrier NAT, multicast, reserved, and IPv6 equivalents. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const n = v4ToInt(ip);
    return V4_BLOCKED.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return ((n & mask) >>> 0) === ((v4ToInt(base) & mask) >>> 0);
    });
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (lower === "::" || lower === "::1") return true;
    const first = parseInt(lower.split(":")[0] || "0", 16);
    return (first & 0xfe00) === 0xfc00 /* fc00::/7 */ || (first & 0xffc0) === 0xfe80 /* fe80::/10 */ || (first & 0xff00) === 0xff00 /* multicast */;
  }
  return true; // not an IP at all: refuse
}

/**
 * Hosts refused before any connection. An address written directly in the URL (`http://10.0.0.1/`,
 * `http://[::1]/`, or `0x7f000001`, which URL parsing turns into 127.0.0.1) never goes through a
 * DNS lookup, so the lookup-time check in safeFetch can't see it — it has to be checked here.
 */
export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  return net.isIP(h) !== 0 && isPrivateAddress(h);
}

// Thumbnails are only relayed from the video/music sites' own image servers.
const THUMBNAIL_HOSTS = [
  "ytimg.com", "vimeocdn.com", "tiktokcdn.com", "tiktokcdn-us.com", "ibyteimg.com", "jtvnw.net",
  "cdninstagram.com", "fbcdn.net", "scdn.co", "spotifycdn.com", "sndcdn.com",
];

export function isAllowedThumbnailHost(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    return THUMBNAIL_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));
  } catch {
    return false;
  }
}
