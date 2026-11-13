import { detectEmbed, isShortLink, PROVIDER_NAMES, type Embed, type EmbedProvider } from "@/lib/embeds";
import { isAllowedThumbnailHost, parseHtmlMeta } from "@/lib/linkMeta";
import { safeFetch } from "@/lib/server/safeFetch";

export type LinkPreview = {
  url: string;
  siteName: string;
  title: string;
  description: string | null;
  author: string | null;
  embed: Embed | null;
  /** Our own image relay URL for the play card's thumbnail (never the third-party URL itself). */
  thumbnail: string | null;
};

// Public oEmbed endpoints: a reliable title, author and thumbnail for each player.
const OEMBED: Partial<Record<EmbedProvider, (url: string) => string>> = {
  youtube: (u) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u)}`,
  vimeo: (u) => `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(u)}`,
  tiktok: (u) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(u)}`,
  spotify: (u) => `https://open.spotify.com/oembed?url=${encodeURIComponent(u)}`,
  soundcloud: (u) => `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(u)}`,
};

function str(v: unknown, max = 200): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

async function pageMeta(url: string) {
  const res = await safeFetch(url);
  if (res.status >= 400 || !res.contentType.includes("html")) return null;
  return parseHtmlMeta(res.body.toString("utf8"));
}

function relay(image: string | null): string | null {
  return image && isAllowedThumbnailHost(image) ? `/api/link-preview/image?src=${encodeURIComponent(image)}` : null;
}

/** Build the preview for one pasted link, or null if there's nothing worth showing. */
export async function buildLinkPreview(rawUrl: string): Promise<LinkPreview | null> {
  let url = rawUrl;
  if (isShortLink(url)) url = (await safeFetch(url, { maxBytes: 64 * 1024 })).finalUrl;

  const embed = detectEmbed(url);
  if (embed) {
    const name = PROVIDER_NAMES[embed.provider];
    let title: string | null = null;
    let author: string | null = null;
    let image: string | null = null;
    const oembed = OEMBED[embed.provider];
    try {
      if (oembed) {
        const res = await safeFetch(oembed(url), { accept: "application/json", maxBytes: 128 * 1024 });
        if (res.status < 400) {
          const j = JSON.parse(res.body.toString("utf8")) as Record<string, unknown>;
          title = str(j.title);
          author = str(j.author_name, 100);
          image = str(j.thumbnail_url, 2000);
        }
      }
    } catch {
      // Fall through to the page itself.
    }
    if (!title) {
      // No oEmbed for this site, or it didn't answer (TikTok's sometimes doesn't): read the page.
      try {
        const meta = await pageMeta(url);
        title = meta?.title ?? null;
        image = image ?? meta?.image ?? null;
      } catch {
        // Still playable without a title or thumbnail.
      }
    }
    // TikTok serves the same placeholder page to every visitor that isn't a browser.
    if (title?.startsWith("TikTok - Make Your Day")) title = null;
    return { url, siteName: name, title: title ?? `${name} ${embed.shape === "audio" || embed.shape === "audio-tall" ? "audio" : "video"}`, description: null, author, embed, thumbnail: relay(image) };
  }

  const meta = await pageMeta(url);
  if (!meta?.title) return null;
  return {
    url,
    siteName: meta.siteName ?? new URL(url).hostname.replace(/^www\./, ""),
    title: meta.title,
    description: meta.description,
    author: null,
    embed: null,
    thumbnail: null, // no third-party images for ordinary sites (they'd learn viewers' IP addresses)
  };
}
