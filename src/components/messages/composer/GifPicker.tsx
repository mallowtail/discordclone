"use client";

import { useEffect, useRef, useState } from "react";
import { useTopmostEscape } from "@/components/ui/overlayStack";
import { gifRelayUrl, type Gif } from "@/lib/messages/gifs";
import { Gif as GifIcon, MagnifyingGlass } from "@phosphor-icons/react";

type Page = { gifs: Gif[]; hasNext: boolean };

async function fetchGifs(q: string, page: number): Promise<Page & { error?: string }> {
  const res = await fetch(`/api/gifs?q=${encodeURIComponent(q)}&page=${page}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { gifs: [], hasNext: false, error: body.error ?? "GIF search is unavailable right now" };
  return body as Page;
}

/** The GIF button in the message box and its search panel. Picking a GIF sends it right away. */
export function GifPicker({ onPick, disabled }: { onPick: (gif: Gif) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);

  // Search as you type, but only after a short pause (each search uses up the shared GIF quota).
  useEffect(() => {
    if (!open) return;
    const my = ++reqId.current;
    const t = setTimeout(async () => {
      setLoading(true);
      const r = await fetchGifs(query.trim(), 1);
      if (my !== reqId.current) return;
      setGifs(r.gifs);
      setHasNext(r.hasNext);
      setPage(1);
      setError(r.error ?? null);
      setLoading(false);
    }, query ? 400 : 0);
    return () => clearTimeout(t);
  }, [open, query]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  useTopmostEscape(open, () => setOpen(false));

  async function more() {
    const my = ++reqId.current;
    setLoading(true);
    const r = await fetchGifs(query.trim(), page + 1);
    if (my !== reqId.current) return;
    setGifs((cur) => [...cur, ...r.gifs.filter((g) => !cur.some((c) => c.id === g.id))]);
    setHasNext(r.hasNext);
    setPage(page + 1);
    setLoading(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} title="GIFs" aria-label="Send a GIF" aria-expanded={open}
        disabled={disabled}
        className="w-11 h-11 md:w-8 md:h-8 flex items-center justify-center rounded-full text-muted hover:text-ink disabled:opacity-50">
        <GifIcon size={22} />
      </button>
      {open && (
        <div role="dialog" aria-label="GIFs"
          className="absolute bottom-full right-0 mb-2 z-30 w-[min(90vw,360px)] h-[min(60vh,440px)] flex flex-col rounded-card border border-line bg-surface shadow-xl">
          <div className="p-2 border-b border-line">
            <div className="flex items-center gap-2 rounded-control bg-surface-2 border border-line px-2 focus-within:border-accent">
              <MagnifyingGlass size={15} className="text-muted flex-none" aria-hidden="true" />
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search KLIPY"
                aria-label="Search GIFs" maxLength={100}
                className="flex-1 min-w-0 bg-transparent py-2 text-body text-ink outline-none" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {!query && gifs.length > 0 && <p className="px-1 pb-1.5 text-micro font-semibold uppercase tracking-wider text-muted">Trending</p>}
            {error ? (
              <p className="p-3 text-body text-muted">{error}</p>
            ) : gifs.length === 0 && !loading ? (
              <p className="p-3 text-body text-muted">No GIFs found.</p>
            ) : (
              <div className="columns-2 gap-1.5">
                {gifs.map((g) => (
                  <button key={g.id} type="button" onClick={() => { setOpen(false); onPick(g); }} title={g.title}
                    aria-label={`Send GIF: ${g.title || "untitled"}`}
                    className="mb-1.5 block w-full overflow-hidden rounded-row bg-surface-2 hover:ring-2 hover:ring-accent focus-visible:ring-2 focus-visible:ring-accent">
                    {/* eslint-disable-next-line @next/next/no-img-element -- relayed animated WebP; next/image would freeze it */}
                    <img src={gifRelayUrl(g.preview.url)} alt="" width={g.preview.width} height={g.preview.height} loading="lazy"
                      className="block w-full h-auto" />
                  </button>
                ))}
              </div>
            )}
            {loading && <p className="p-2 text-center text-meta text-muted">Loading…</p>}
            {hasNext && !loading && !error && (
              <button type="button" onClick={more} className="mt-1 w-full rounded-control py-2 text-meta text-muted hover:bg-surface-2 hover:text-ink">
                Load more
              </button>
            )}
          </div>
          <p className="px-3 py-1.5 border-t border-line text-micro text-muted text-right">Powered by KLIPY</p>
        </div>
      )}
    </div>
  );
}
