// What happens when someone clicks a link in chat (the "Leaving Mallowchat" warning, like Discord's).

export type LinkDecision =
  | { kind: "internal"; path: string } // this app: open in place
  | { kind: "open"; url: string } // a site they trust: open straight away
  | { kind: "confirm"; url: string; hostname: string } // anything else: ask first
  | { kind: "block" }; // not a web link at all

export function linkDecision(href: string, origin: string, trusted: string[]): LinkDecision {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return { kind: "block" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { kind: "block" };
  if (u.origin === origin) return { kind: "internal", path: `${u.pathname}${u.search}${u.hash}` };
  const hostname = u.hostname.toLowerCase();
  // Exact hostname only: trusting example.com doesn't trust evil.example.com.
  if (trusted.includes(hostname)) return { kind: "open", url: href };
  return { kind: "confirm", url: href, hostname };
}

export function addTrustedDomain(list: string[], hostname: string): string[] {
  return [...new Set([...list, hostname.toLowerCase()])].sort();
}

export function removeTrustedDomain(list: string[], hostname: string): string[] {
  return list.filter((d) => d !== hostname);
}
