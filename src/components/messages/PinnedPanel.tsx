"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useTopmostEscape } from "@/components/ui/overlayStack";
import { Skeleton } from "@/components/ui/Skeleton";
import { createClient } from "@/lib/supabase/client";
import type { Message, Profile } from "@/types/db";
import { PushPin, X } from "@phosphor-icons/react";

function snippet(m: Message): string {
  if (m.content) return m.content.length > 80 ? m.content.slice(0, 80) + "…" : m.content;
  if (m.image_url) return "Image";
  if (m.file_url) return "File";
  return "";
}

/** Distance from the bottom of the list (px) at which the next page is requested. */
const LOAD_MORE_THRESHOLD = 100;

export function PinnedPanel({
  pins,
  loading,
  hasMore,
  onLoadMore,
  onClose,
}: {
  pins: Message[];
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onClose: () => void;
}) {
  const supabase = createClient();
  const router = useRouter();
  const pathname = usePathname();
  const [names, setNames] = useState<Record<string, string>>({});
  // Author ids already requested, so each newly loaded page only fetches its new authors.
  const requested = useRef<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside the panel (or pressing Escape). The pins toggle button is
  // excluded so clicking it still toggles cleanly instead of close-then-reopen.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const el = e.target as Element | null;
      if (!ref.current || ref.current.contains(el)) return;
      if (el?.closest?.('[data-trigger="pins"]')) return;
      onClose();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  useTopmostEscape(true, onClose);

  useEffect(() => {
    const ids = [...new Set(pins.map((m) => m.author_id))].filter((id) => !requested.current.has(id));
    if (ids.length === 0) return;
    ids.forEach((id) => requested.current.add(id));
    supabase.from("profiles").select("*").in("id", ids).then(({ data, error }) => {
      if (error) {
        // allow a retry on the next page/render
        ids.forEach((id) => requested.current.delete(id));
        return;
      }
      const next: Record<string, string> = {};
      (data as Profile[] | null)?.forEach((p) => (next[p.id] = p.display_name));
      setNames((prev) => ({ ...prev, ...next }));
    });
  }, [supabase, pins]);

  // Fill the viewport: if a freshly landed page doesn't overflow the list, nothing can be scrolled
  // to trigger the next one. Runs once per NEW pins array (i.e. after a successful page or a
  // realtime change), never after a failed fetch (which leaves the array untouched) → no loop.
  const lastFillCheck = useRef<Message[] | null>(null);
  useEffect(() => {
    const el = listRef.current;
    if (!el || loading || !hasMore || pins.length === 0 || lastFillCheck.current === pins) return;
    lastFillCheck.current = pins;
    if (el.scrollHeight <= el.clientHeight) onLoadMore();
  }, [pins, loading, hasMore, onLoadMore]);

  function onScroll() {
    const el = listRef.current;
    if (!el || !hasMore || loading) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= LOAD_MORE_THRESHOLD) onLoadMore();
  }

  function jump(id: string) {
    const el = document.getElementById(`msg-${id}`);
    // Instant, like MessageList's anchor jump: a smooth scroll near the top crosses the load-older
    // threshold mid-flight and the prepend scroll compensation cuts it short.
    if (el) el.scrollIntoView({ behavior: "instant", block: "center" });
    else router.replace(`${pathname}?msg=${id}`);
    onClose();
  }

  async function unpin(id: string) {
    await supabase.rpc("toggle_pin", { msg: id });
  }

  return (
    <div ref={ref} className="absolute right-3 top-12 w-72 bg-sidebar border border-line rounded-card p-2 shadow-xl z-50">
      <div className="text-micro font-semibold uppercase tracking-wider text-muted mb-2 flex items-center gap-1">
        <PushPin size={12} aria-hidden="true" /> Pinned Messages
      </div>
      <div ref={listRef} onScroll={onScroll} className="max-h-[60vh] overflow-y-auto">
        {pins.length === 0 && !loading && <div className="text-muted text-body px-1 py-2">No pinned messages yet.</div>}
        {pins.map((m) => (
          <div key={m.id} className="bg-surface rounded-control p-2 text-meta mb-1.5">
            <button onClick={() => unpin(m.id)} title="Unpin" aria-label="Unpin" className="float-right text-muted hover:text-ink">
              <X size={16} weight="bold" />
            </button>
            <div className="text-ink font-semibold cursor-pointer" onClick={() => jump(m.id)}>
              {names[m.author_id] ?? "…"}
            </div>
            <div className="text-ink cursor-pointer" onClick={() => jump(m.id)}>
              {snippet(m)}
            </div>
          </div>
        ))}
        {loading &&
          Array.from({ length: pins.length === 0 ? 3 : 1 }).map((_, i) => (
            <div key={i} aria-hidden="true" className="rounded-control p-2 mb-1.5 flex flex-col gap-2">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
      </div>
    </div>
  );
}
