"use client";

import { useEffect, useRef, useState } from "react";
import { useTopmostEscape } from "@/components/ui/overlayStack";
import { useAuth } from "@/components/providers/AuthProvider";
import { normalizeKlipyItem, type Gif } from "@/lib/messages/gifs";
import { Gif as GifIcon, MagnifyingGlass, Star } from "@phosphor-icons/react";
import { GifFavoriteStar } from "@/components/messages/list/GifFavoriteStar";
import { useFavoriteGifs } from "@/components/providers/FavoriteGifsProvider";

type Page = { gifs: Gif[]; hasNext: boolean };

// KLIPY's integration rules: the browser calls their API itself (their keys are made to be used in
// apps), results are shown in the order given, and media loads straight from their URLs.
const KLIPY_KEY = process.env.NEXT_PUBLIC_KLIPY_API_KEY;
// PG-13: on KLIPY the same set as their loosest setting; their library is human-moderated.
const RATING = "pg-13";

/** KLIPY wants a per-user id; send a one-way hash, not the real account id. */
async function customerId(userId: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`mallowchat:${userId}`));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function fetchGifs(q: string, page: number, userId: string): Promise<Page & { error?: string }> {
  if (!KLIPY_KEY) return { gifs: [], hasNext: false, error: "GIFs aren't set up yet" };
  const params = new URLSearchParams({
    page: String(page), per_page: "24", customer_id: await customerId(userId), rating: RATING, locale: "en",
  });
  if (q) params.set("q", q);
  try {
    const res = await fetch(`https://api.klipy.com/api/v1/${encodeURIComponent(KLIPY_KEY)}/gifs/${q ? "search" : "trending"}?${params}`);
    if (!res.ok) return { gifs: [], hasNext: false, error: res.status === 429 ? "Too many GIF searches — try again in a minute" : "GIF search is unavailable right now" };
    const body = (await res.json()) as { data?: { data?: unknown[]; has_next?: boolean } };
    const gifs = (body.data?.data ?? [])
      .map((i) => normalizeKlipyItem(i as Parameters<typeof normalizeKlipyItem>[0]))
      .filter((g): g is Gif => !!g); // only items with no file at all, which can't be shown
    return { gifs, hasNext: !!body.data?.has_next };
  } catch {
    return { gifs: [], hasNext: false, error: "GIF search is unavailable right now" };
  }
}

/** The GIF button in the message box and its search panel. Picking a GIF sends it right away. */
export function GifPicker({ onPick, disabled }: { onPick: (gif: Gif) => void; disabled?: boolean }) {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"klipy" | "favorites">("klipy");
  const { favorites } = useFavoriteGifs();
  const [query, setQuery] = useState("");
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);

  // Search as you type, but only after a short pause (each search uses up the GIF quota).
  useEffect(() => {
    if (!open || !userId) return;
    const my = ++reqId.current;
    const t = setTimeout(async () => {
      setLoading(true);
      const r = await fetchGifs(query.trim(), 1, userId);
      if (my !== reqId.current) return;
      setGifs(r.gifs);
      setHasNext(r.hasNext);
      setPage(1);
      setError(r.error ?? null);
      setLoading(false);
    }, query ? 400 : 0);
    return () => clearTimeout(t);
  }, [open, query, userId]);

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
    const r = await fetchGifs(query.trim(), page + 1, userId);
    if (my !== reqId.current) return;
    setGifs((cur) => [...cur, ...r.gifs]); // appended as given, in KLIPY's order
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
              <input autoFocus value={query} onChange={(e) => { setQuery(e.target.value); setTab("klipy"); }} placeholder="Search KLIPY"
                aria-label="Search GIFs" maxLength={100}
                className="flex-1 min-w-0 bg-transparent py-2 text-body text-ink outline-none" />
            </div>
          </div>
          <div className="flex gap-1 px-2 pt-2" role="tablist" aria-label="GIF sections">
            {([["klipy", query ? "Results" : "Trending"], ["favorites", `Favorites${favorites.length ? ` (${favorites.length})` : ""}`]] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                className={`flex items-center gap-1 rounded-control px-2.5 py-1 text-meta font-medium min-h-9 md:min-h-0 ${
                  tab === id ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"
                }`}>
                {id === "favorites" && <Star size={13} weight="fill" className="text-amber" aria-hidden="true" />}
                {label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {tab === "favorites" ? (
              favorites.length === 0 ? (
                <p className="p-3 text-body text-muted">No favorites yet. Hover over a GIF and click the star to save it here.</p>
              ) : (
                <div className="columns-2 gap-1.5">
                  {favorites.map((f) => (
                    <GifTile key={f.url} gif={{ id: f.url, title: f.title, preview: f, full: f }}
                      onSend={(g) => { setOpen(false); onPick(g); }} />
                  ))}
                </div>
              )
            ) : error ? (
              <p className="p-3 text-body text-muted">{error}</p>
            ) : gifs.length === 0 && !loading ? (
              <p className="p-3 text-body text-muted">No GIFs found.</p>
            ) : (
              // KLIPY's results in their own grid, in the order given.
              <div className="columns-2 gap-1.5">
                {gifs.map((g, i) => (
                  <GifTile key={`${g.id}-${i}`} gif={g} onSend={(x) => { setOpen(false); onPick(x); }} />
                ))}
              </div>
            )}
            {tab === "klipy" && loading && <p className="p-2 text-center text-meta text-muted">Loading…</p>}
            {tab === "klipy" && hasNext && !loading && !error && (
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

/** One GIF in the picker: click to send, star (top-right, on hover) to favourite. */
function GifTile({ gif, onSend }: { gif: Gif; onSend: (g: Gif) => void }) {
  return (
    <div className="group relative mb-1.5 break-inside-avoid">
      <button type="button" onClick={() => onSend(gif)} title={gif.title}
        aria-label={`Send GIF: ${gif.title || "untitled"}`}
        className="block w-full overflow-hidden rounded-row bg-surface-2 hover:ring-2 hover:ring-accent focus-visible:ring-2 focus-visible:ring-accent">
        {/* eslint-disable-next-line @next/next/no-img-element -- KLIPY media must load directly from their URL */}
        <img src={gif.preview.url} alt="" width={gif.preview.width} height={gif.preview.height} loading="lazy"
          className="block w-full h-auto" />
      </button>
      <GifFavoriteStar gif={{ url: gif.full.url, width: gif.full.width, height: gif.full.height, title: gif.title }} />
    </div>
  );
}
