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

/** An IPv6 address as its 16 bytes (handles "::" and a trailing dotted IPv4), or null if malformed. */
function ipv6Bytes(ip: string): number[] | null {
  let text = ip.toLowerCase().split("%")[0]; // drop a zone id like %eth0
  const tail = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    if (!net.isIPv4(tail[1])) return null;
    const [p, q, r, t] = tail[1].split(".").map(Number);
    text = text.slice(0, -tail[1].length) + `${((p << 8) | q).toString(16)}:${((r << 8) | t).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...rest];
  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    bytes.push(n >> 8, n & 0xff);
  }
  return bytes.length === 16 ? bytes : null;
}

const v4 = (b: number[]) => b.join(".");

/** True for any address the server must never fetch: loopback, private, link-local (incl. cloud
 *  metadata at 169.254.169.254), carrier NAT, multicast, reserved, and IPv6 equivalents —
 *  including the IPv6 forms that carry an IPv4 address inside (mapped, compatible, NAT64, 6to4,
 *  Teredo), however they're written. Anything unparseable counts as blocked. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const n = v4ToInt(ip);
    return V4_BLOCKED.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return ((n & mask) >>> 0) === ((v4ToInt(base) & mask) >>> 0);
    });
  }
  const b = net.isIPv6(ip.split("%")[0]) ? ipv6Bytes(ip) : null;
  if (!b) return true;
  const zeros = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  if (zeros(0, 10) && b[10] === 0xff && b[11] === 0xff) return isPrivateAddress(v4(b.slice(12))); // ::ffff:a.b.c.d
  if (zeros(0, 12)) return true; // ::/96 — ::, ::1 and the long-retired IPv4-compatible form
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zeros(4, 12)) return isPrivateAddress(v4(b.slice(12))); // 64:ff9b::/96
  if (b[0] === 0x20 && b[1] === 0x02) return isPrivateAddress(v4(b.slice(2, 6))); // 2002::/16 (6to4)
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return true; // 2001::/32 (Teredo)
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // 2001:db8::/32 (documentation)
  if ((b[0] & 0xfe) === 0xfc) return true; // fc00::/7 (unique local)
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // fe80::/10 (link-local)
  if (b[0] === 0xff) return true; // multicast
  return false;
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
  "cdninstagram.com", "fbcdn.net", "scdn.co", "spotifycdn.com", "sndcdn.com", "klipy.com",
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
