"use client";

import { useEffect, useRef, useState } from "react";
import { useTopmostEscape } from "@/components/ui/overlayStack";
import { useServers } from "@/hooks/useServers";
import { useStickers } from "@/hooks/useStickers";
import { ServerIcon } from "@/components/servers/layout/ServerIcon";
import { fitSticker, groupStickersByServer, stickerPublicUrl, type Sticker } from "@/lib/messages/stickers";
import { MagnifyingGlass, Sticker as StickerIcon } from "@phosphor-icons/react";

const TILE_MAX = 80;

/** The sticker button in the message box and its panel. Picking a sticker sends it right away. */
export function StickerPicker({ onPick, disabled }: { onPick: (s: Sticker) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { servers } = useServers();
  const { stickers, loading } = useStickers(open);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  useTopmostEscape(open, () => setOpen(false));

  const groups = groupStickersByServer(stickers, servers, query);

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} title="Stickers" aria-label="Stickers" aria-expanded={open}
        disabled={disabled}
        className="w-11 h-11 md:w-8 md:h-8 flex items-center justify-center rounded-full text-muted hover:text-ink disabled:opacity-50">
        <StickerIcon size={22} />
      </button>
      {open && (
        <div role="dialog" aria-label="Stickers"
          className="absolute bottom-full right-0 mb-2 z-30 w-[min(90vw,360px)] h-[min(60vh,440px)] flex flex-col rounded-card border border-line bg-surface shadow-xl">
          <div className="p-2 border-b border-line">
            <div className="flex items-center gap-2 rounded-control bg-surface-2 border border-line px-2 focus-within:border-accent">
              <MagnifyingGlass size={15} className="text-muted flex-none" aria-hidden="true" />
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search stickers"
                aria-label="Search stickers" maxLength={100}
                className="flex-1 min-w-0 bg-transparent py-2 text-body text-ink outline-none" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {loading && stickers.length === 0 ? (
              <p className="p-2 text-center text-meta text-muted">Loading…</p>
            ) : stickers.length === 0 ? (
              <p className="p-3 text-body text-muted">No stickers yet — server admins can add them in Server Settings → Stickers.</p>
            ) : groups.length === 0 ? (
              <p className="p-3 text-body text-muted">No stickers match</p>
            ) : (
              groups.map(({ server, stickers: list }) => (
                <section key={server.id} className="mb-3">
                  <h3 className="flex items-center gap-2 px-1 pb-1.5 text-meta font-medium text-muted">
                    <span className="[&>*]:w-5 [&>*]:h-5 [&>*]:text-micro flex-none flex"><ServerIcon iconUrl={server.icon_url} name={server.name} /></span>
                    <span className="truncate">{server.name}</span>
                  </h3>
                  <div className="grid grid-cols-4 gap-1.5">
                    {list.map((s) => {
                      const scale = fitSticker(s.width, s.height);
                      const k = Math.min(1, TILE_MAX / Math.max(scale.width, scale.height));
                      return (
                        <button key={s.id} type="button" title={s.name} aria-label={`Send sticker: ${s.name}`}
                          onClick={() => { setOpen(false); onPick(s); }}
                          className="aspect-square flex items-center justify-center rounded-row hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent">
                          {/* eslint-disable-next-line @next/next/no-img-element -- stickers are small public files, often animated */}
                          <img src={stickerPublicUrl(s.path)} alt="" loading="lazy"
                            width={Math.round(scale.width * k)} height={Math.round(scale.height * k)}
                            className="block max-w-full max-h-full object-contain" />
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
