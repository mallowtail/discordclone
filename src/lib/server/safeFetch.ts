import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import type { LookupFunction } from "node:net";
import { isBlockedHostname, isPrivateAddress } from "@/lib/linkMeta";

/**
 * Fetch a URL someone pasted, without letting it reach private networks. The address check runs
 * inside the socket's own DNS lookup, for every connection (each redirect hop too), so a hostname
 * that resolves to a public address when checked and a private one when connected ("DNS
 * rebinding") can't slip through. Only http/https on the default ports; capped size and time.
 */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = addresses as dns.LookupAddress[];
    if (list.length === 0 || list.some((a) => isPrivateAddress(a.address))) {
      return callback(Object.assign(new Error("blocked address"), { code: "EBLOCKED" }), "", 4);
    }
    if (options.all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

export type SafeResponse = { status: number; contentType: string; body: Buffer; finalUrl: string };

const USER_AGENT = "Mozilla/5.0 (compatible; MallowchatPreview/1.0; link previews)";

function once(url: URL, accept: string, maxBytes: number, timeoutMs: number) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method: "GET",
        lookup: safeLookup,
        timeout: timeoutMs,
        headers: { "user-agent": USER_AGENT, accept, "accept-language": "en" },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            // Enough for the <head>; stop reading the rest.
            chunks.push(c.subarray(0, Math.max(0, c.length - (size - maxBytes))));
            res.destroy();
            return resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) });
          }
          chunks.push(c);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

export async function safeFetch(
  rawUrl: string,
  { accept = "text/html,application/xhtml+xml", maxBytes = 512 * 1024, timeoutMs = 5000, maxRedirects = 4 } = {}
): Promise<SafeResponse> {
  let url = new URL(rawUrl);
  for (let hop = 0; ; hop++) {
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("bad protocol");
    if (url.port && url.port !== "80" && url.port !== "443") throw new Error("bad port");
    if (url.username || url.password) throw new Error("credentials in url");
    if (isBlockedHostname(url.hostname)) throw new Error("blocked address");
    const res = await once(url, accept, maxBytes, timeoutMs);
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop >= maxRedirects) throw new Error("too many redirects");
      url = new URL(location, url);
      continue;
    }
    return {
      status: res.status,
      contentType: String(res.headers["content-type"] ?? "").toLowerCase(),
      body: res.body,
      finalUrl: url.toString(),
    };
  }
}
