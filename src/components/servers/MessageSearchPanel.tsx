"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseSearchQuery } from "@/lib/searchQuery";
import { searchMessages } from "@/lib/search";
import type { SearchResult } from "@/types/db";
import { Avatar } from "@/components/user/Avatar";
import { MagnifyingGlass, X, Hash } from "@phosphor-icons/react";

const PAGE = 25;

export function MessageSearchPanel({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const pathname = usePathname();
  const [raw, setRaw] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false); // no more pages
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Debounced fresh search whenever the query changes.
  useEffect(() => {
    const q = raw.trim();
    if (!q) { setResults([]); setError(null); setDone(false); return; }
    let active = true;
    const t = setTimeout(async () => {
      setBusy(true); setError(null);
      try {
        const rows = await searchMessages(supabase, serverId, parseSearchQuery(raw), { lim: PAGE, off: 0 });
        if (active) { setResults(rows); setDone(rows.length < PAGE); }
      } catch { if (active) setError("Search failed"); }
      finally { if (active) setBusy(false); }
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [raw, serverId, supabase]);

  async function loadMore() {
    setBusy(true);
    try {
      const rows = await searchMessages(supabase, serverId, parseSearchQuery(raw), { lim: PAGE, off: results.length });
      setResults((prev) => [...prev, ...rows]);
      setDone(rows.length < PAGE);
    } catch { setError("Search failed"); }
    finally { setBusy(false); }
  }

  function jumpTo(r: SearchResult) {
    const dest = `/channels/${r.channel_id}?msg=${r.id}`;
    // Same channel → replace (re-anchors in place); different channel → push (navigates).
    if (pathname === `/channels/${r.channel_id}`) router.replace(dest);
    else router.push(dest);
  }

  return (
    <aside className="w-72 bg-sidebar border-l border-line flex flex-col">
      <div className="p-2 border-b border-line flex items-center gap-2">
        <div className="relative flex-1">
          <MagnifyingGlass size={15} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <input
            ref={inputRef}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="Search"
            className="w-full pl-8 pr-2 py-1.5 rounded bg-surface-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <button onClick={onClose} aria-label="Close search" className="text-muted hover:text-ink">
          <X size={16} weight="bold" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
        {!raw.trim() && <p className="text-muted text-xs p-2">Search this server. Try <code>from:name</code>, <code>has:image</code>, <code>before:2026-09</code>.</p>}
        {error && <p className="text-danger text-xs p-2">{error}</p>}
        {raw.trim() && !busy && !error && results.length === 0 && <p className="text-muted text-xs p-2">No results.</p>}
        {results.map((r) => (
          <button key={r.id} onClick={() => jumpTo(r)}
            className="text-left p-2 rounded hover:bg-surface flex flex-col gap-1">
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <Avatar url={r.author_avatar_url} name={r.author_display_name} size="sm" />
              <span className="text-ink font-medium">{r.author_display_name}</span>
              <Hash size={11} />{r.channel_name}
              <span className="ml-auto">{new Date(r.created_at).toLocaleDateString()}</span>
            </span>
            <span className="text-sm text-ink line-clamp-3">
              {r.content || (r.image_url ? "🖼️ image" : r.file_name ? `📎 ${r.file_name}` : "")}
            </span>
          </button>
        ))}
        {results.length > 0 && !done && (
          <button onClick={loadMore} disabled={busy}
            className="text-xs text-accent hover:underline p-2 disabled:opacity-50">
            {busy ? "Loading…" : "Load more"}
          </button>
        )}
      </div>
    </aside>
  );
}
