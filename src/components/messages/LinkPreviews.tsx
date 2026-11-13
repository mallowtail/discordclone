"use client";

import { useEffect, useState } from "react";
import { extractLinks, withParent, type EmbedShape } from "@/lib/embeds";
import type { LinkPreview } from "@/lib/server/linkPreview";
import { Play } from "@phosphor-icons/react";

// One request per link per page load, shared by every message that shows it.
const requests = new Map<string, Promise<LinkPreview | null>>();

function fetchPreview(url: string): Promise<LinkPreview | null> {
  let p = requests.get(url);
  if (!p) {
    p = fetch(`/api/link-preview?url=${encodeURIComponent(url)}`)
      .then((r) => (r.ok ? r.json() : { preview: null }))
      .then((j: { preview: LinkPreview | null }) => j.preview)
      .catch(() => null);
    requests.set(url, p);
  }
  return p;
}

/** Previews for the links in a message (up to 3, none for links inside code). */
export function LinkPreviews({ content }: { content: string }) {
  const links = extractLinks(content);
  if (links.length === 0) return null;
  return (
    <div className="mt-1 space-y-2">
      {links.map((url) => <LinkPreviewCard key={url} url={url} />)}
    </div>
  );
}

function LinkPreviewCard({ url }: { url: string }) {
  const [preview, setPreview] = useState<LinkPreview | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    fetchPreview(url).then((p) => {
      if (active) setPreview(p);
    });
    return () => { active = false; };
  }, [url]);

  if (!preview) return null; // loading, or nothing worth showing

  return (
    <div className="max-w-md rounded-card border border-line border-l-4 border-l-accent/60 bg-surface p-3">
      <div className="text-micro font-medium text-muted truncate">
        {preview.siteName}
        {preview.author && <> · {preview.author}</>}
      </div>
      <a href={preview.url} target="_blank" rel="noopener noreferrer"
        className="mt-0.5 block text-body font-semibold text-accent hover:underline break-words">
        {preview.title}
      </a>
      {preview.description && <p className="mt-1 text-meta text-muted line-clamp-3 break-words">{preview.description}</p>}
      {preview.embed && (
        <Player src={preview.embed.src} needsParent={!!preview.embed.needsParent} shape={preview.embed.shape}
          thumbnail={preview.thumbnail} label={`Play ${preview.title}`} />
      )}
    </div>
  );
}

const FRAME: Record<EmbedShape, string> = {
  video: "w-full aspect-video",
  vertical: "w-full max-w-[325px] aspect-[9/16] max-h-[580px]",
  instagram: "w-full max-w-[400px] h-[560px]",
  audio: "w-full h-[152px]",
  "audio-tall": "w-full h-[352px]",
};

/**
 * Click-to-play: until pressed it's our own thumbnail (relayed through our server) and a play
 * button, so the video site learns nothing about who's scrolling past. Pressing play loads the
 * site's real player in place.
 */
function Player({ src, needsParent, shape, thumbnail, label }: {
  src: string; needsParent: boolean; shape: EmbedShape; thumbnail: string | null; label: string;
}) {
  const [playing, setPlaying] = useState(false);
  const frame = FRAME[shape];
  const audio = shape === "audio" || shape === "audio-tall";

  if (playing) {
    const full = needsParent ? withParent(src, window.location.hostname) : src;
    return (
      <iframe src={full} title={label} className={`mt-2 rounded-control border-0 bg-black ${frame}`}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write"
        allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
    );
  }

  return (
    <button type="button" onClick={() => setPlaying(true)} aria-label={label}
      className={`group relative mt-2 overflow-hidden rounded-control bg-surface-2 ${audio ? "w-full h-24" : frame}`}>
      {thumbnail && (
        // eslint-disable-next-line @next/next/no-img-element -- our own relay route; nothing for next/image to optimise
        <img src={thumbnail} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
      )}
      <span className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/30">
        <span className="flex h-14 w-14 items-center justify-center rounded-pill bg-black/70 text-white group-hover:bg-accent">
          <Play size={26} weight="fill" aria-hidden="true" />
        </span>
      </span>
    </button>
  );
}
