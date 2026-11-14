// Which links get a playable embed, and the player address for each. Pure, so it's shared by the
// server (link-preview route) and tested directly.

export type EmbedProvider = "youtube" | "twitch" | "tiktok" | "instagram" | "vimeo" | "spotify" | "soundcloud";
/** Player size: 16:9 video, 9:16 phone video, Instagram's tall post, and short/tall audio players. */
export type EmbedShape = "video" | "vertical" | "instagram" | "audio" | "audio-tall";

export type Embed = {
  provider: EmbedProvider;
  src: string;
  shape: EmbedShape;
  /** Twitch refuses to play unless `parent=<this site's hostname>` is on the URL (see withParent). */
  needsParent?: boolean;
};

export const PROVIDER_NAMES: Record<EmbedProvider, string> = {
  youtube: "YouTube",
  twitch: "Twitch",
  tiktok: "TikTok",
  instagram: "Instagram",
  vimeo: "Vimeo",
  spotify: "Spotify",
  soundcloud: "SoundCloud",
};

const MAX_LINKS = 3;

/** Up to 3 distinct http(s) links in a message, skipping any inside `code` or ```code blocks```. */
export function extractLinks(content: string): string[] {
  const text = content.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");
  const out: string[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
    let url = m[0];
    // Trailing punctuation belongs to the sentence; a ")" only to an unbalanced "(" (markdown links).
    for (;;) {
      if (/[.,!?;:'"]$/.test(url)) url = url.slice(0, -1);
      else if (url.endsWith(")") && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) url = url.slice(0, -1);
      else break;
    }
    if (!out.includes(url)) out.push(url);
    if (out.length === MAX_LINKS) break;
  }
  return out;
}

function parse(url: string): URL | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

/** Matches `domain` and its subdomains, never lookalikes such as `domain.evil.example`. */
function onDomain(u: URL, domain: string): boolean {
  const h = u.hostname.toLowerCase();
  return h === domain || h.endsWith(`.${domain}`);
}

/** YouTube's `t` can be "42", "42s" or "1h2m5s". */
function youtubeStart(t: string | null): number | null {
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m || !m[0]) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

// Twitch paths that are pages, not channels.
const TWITCH_RESERVED = new Set([
  "directory", "videos", "settings", "p", "downloads", "jobs", "search", "subscriptions", "inventory",
  "wallet", "friends", "messages", "login", "signup", "turbo", "prime", "store", "drops", "user",
]);

export function detectEmbed(url: string): Embed | null {
  const u = parse(url);
  if (!u) return null;
  const parts = u.pathname.split("/").filter(Boolean);

  // YouTube (youtube-nocookie: the player doesn't set tracking cookies until you press play)
  if (onDomain(u, "youtube.com") || onDomain(u, "youtu.be")) {
    let id: string | null = null;
    let shape: EmbedShape = "video";
    if (onDomain(u, "youtu.be")) id = parts[0] ?? null;
    else if (parts[0] === "watch") id = u.searchParams.get("v");
    else if (parts[0] === "shorts" || parts[0] === "live" || parts[0] === "embed") {
      id = parts[1] ?? null;
      if (parts[0] === "shorts") shape = "vertical";
    }
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
    const start = youtubeStart(u.searchParams.get("t") ?? u.searchParams.get("start"));
    return {
      provider: "youtube",
      shape,
      src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1${start ? `&start=${start}` : ""}`,
    };
  }

  if (onDomain(u, "twitch.tv")) {
    const twitch = (src: string): Embed => ({ provider: "twitch", shape: "video", src, needsParent: true });
    if (u.hostname.toLowerCase() === "clips.twitch.tv") {
      return parts[0] && /^[A-Za-z0-9_-]+$/.test(parts[0])
        ? twitch(`https://clips.twitch.tv/embed?clip=${parts[0]}&autoplay=true`)
        : null;
    }
    if (parts[0] === "videos" && /^\d+$/.test(parts[1] ?? "")) {
      return twitch(`https://player.twitch.tv/?video=v${parts[1]}&autoplay=true`);
    }
    if (parts[1] === "clip" && /^[A-Za-z0-9_-]+$/.test(parts[2] ?? "")) {
      return twitch(`https://clips.twitch.tv/embed?clip=${parts[2]}&autoplay=true`);
    }
    const channel = parts[0];
    if (parts.length === 1 && /^[A-Za-z0-9_]{3,25}$/.test(channel) && !TWITCH_RESERVED.has(channel.toLowerCase())) {
      return twitch(`https://player.twitch.tv/?channel=${channel.toLowerCase()}&autoplay=true`);
    }
    return null;
  }

  if (onDomain(u, "tiktok.com")) {
    const i = parts.indexOf("video");
    const id = i >= 0 ? parts[i + 1] : null;
    return id && /^\d{8,25}$/.test(id)
      ? { provider: "tiktok", shape: "vertical", src: `https://www.tiktok.com/player/v1/${id}?autoplay=1` }
      : null;
  }

  if (onDomain(u, "instagram.com")) {
    const kind = parts[0] === "reels" || parts[0] === "reel" ? "reel" : parts[0] === "p" || parts[0] === "tv" ? "p" : null;
    const code = parts[1];
    return kind && code && /^[A-Za-z0-9_-]+$/.test(code)
      ? { provider: "instagram", shape: "instagram", src: `https://www.instagram.com/${kind}/${code}/embed/` }
      : null;
  }

  if (onDomain(u, "vimeo.com")) {
    const id = parts.find((p) => /^\d+$/.test(p));
    return id ? { provider: "vimeo", shape: "video", src: `https://player.vimeo.com/video/${id}?autoplay=1` } : null;
  }

  if (u.hostname.toLowerCase() === "open.spotify.com") {
    const rest = parts[0]?.startsWith("intl-") ? parts.slice(1) : parts;
    const [type, id] = rest;
    if (!type || !id || !/^[A-Za-z0-9]+$/.test(id)) return null;
    if (!["track", "album", "playlist", "episode", "show", "artist"].includes(type)) return null;
    return {
      provider: "spotify",
      shape: type === "track" || type === "episode" ? "audio" : "audio-tall",
      src: `https://open.spotify.com/embed/${type}/${id}`,
    };
  }

  if (u.hostname.toLowerCase() === "soundcloud.com" || u.hostname.toLowerCase() === "www.soundcloud.com") {
    if (parts.length < 2) return null; // a profile, not a track or playlist
    const clean = `https://soundcloud.com/${parts.join("/")}`;
    return {
      provider: "soundcloud",
      shape: "audio",
      src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(clean)}&auto_play=true`,
    };
  }

  return null;
}

/** TikTok's share links redirect to the real video URL; the server follows them before detecting. */
export function isShortLink(url: string): boolean {
  const u = parse(url);
  if (!u) return false;
  const h = u.hostname.toLowerCase();
  return h === "vm.tiktok.com" || h === "vt.tiktok.com" || (onDomain(u, "tiktok.com") && u.pathname.startsWith("/t/"));
}

export function withParent(src: string, hostname: string): string {
  return `${src}&parent=${encodeURIComponent(hostname)}`;
}
