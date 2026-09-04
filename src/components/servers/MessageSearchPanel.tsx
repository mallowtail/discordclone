"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseSearchQuery } from "@/lib/searchQuery";
import { searchMessages } from "@/lib/search";
import { applySuggestion } from "@/lib/searchSuggest";
import { getSuggestions, SearchSuggestions, type Member, type Channel } from "@/components/servers/SearchSuggestions";
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
  const rawRef = useRef(raw);

  const [members, setMembers] = useState<Member[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [caret, setCaret] = useState(0);
  const [acOpen, setAcOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [prevToken, setPrevToken] = useState("");

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { rawRef.current = raw; }, [raw]);

  // Fetch server members + channels once when the panel opens (mirrors MembersPanel / ForwardDialog).
  useEffect(() => {
    (async () => {
      const { data: m } = await supabase
        .from("server_members").select("profiles(id, username, display_name, avatar_url)").eq("server_id", serverId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setMembers(((m ?? []) as any[]).map((r) => r.profiles).filter(Boolean));
      const { data: c } = await supabase.from("channels").select("id, name").eq("server_id", serverId).order("position");
      setChannels((c as Channel[]) ?? []);
    })();
  }, [supabase, serverId]);

  const { token, suggestions } = useMemo(
    () => getSuggestions(raw, caret, members, channels),
    [raw, caret, members, channels]
  );
  // Reset the highlighted row whenever the active token changes (adjusting state during
  // render, per React's guidance, instead of an effect — avoids an extra render pass).
  if (token !== prevToken) { setPrevToken(token); setActiveIdx(0); }
  const dropdownVisible = acOpen && suggestions.length > 0;

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
    const q = raw; // guard: ignore this page if the query changes before it resolves
    setBusy(true);
    try {
      const rows = await searchMessages(supabase, serverId, parseSearchQuery(raw), { lim: PAGE, off: results.length });
      if (rawRef.current === q) {
        setResults((prev) => [...prev, ...rows]);
        setDone(rows.length < PAGE);
      }
    } catch { if (rawRef.current === q) setError("Search failed"); }
    finally { if (rawRef.current === q) setBusy(false); }
  }

  function jumpTo(r: SearchResult) {
    const dest = `/channels/${r.channel_id}?msg=${r.id}`;
    // Same channel → replace (re-anchors in place); different channel → push (navigates).
    if (pathname === `/channels/${r.channel_id}`) router.replace(dest);
    else router.push(dest);
  }

  function acceptSuggestion(value: string) {
    const next = applySuggestion(raw, caret, value);
    setRaw(next.raw);
    setCaret(next.caret);
    // A value ending in a space is a terminal pick (member/channel/has value/pinned:true);
    // an operator like "from:" isn't, so the dropdown stays open to show the next kind.
    if (value.endsWith(" ")) setAcOpen(false);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(next.caret, next.caret);
    });
  }

  function trackCaret(e: React.SyntheticEvent<HTMLInputElement>) {
    setCaret(e.currentTarget.selectionStart ?? e.currentTarget.value.length);
    setAcOpen(true);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (dropdownVisible) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((a) => (a + 1) % suggestions.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((a) => (a - 1 + suggestions.length) % suggestions.length); return; }
      if (e.key === "Enter" || e.key === "Tab") {
        const s = suggestions[activeIdx];
        if (s && s.selectable !== false) { e.preventDefault(); acceptSuggestion(s.value); }
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); setAcOpen(false); return; }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
  }

  return (
    <aside className="w-72 bg-sidebar border-l border-line flex flex-col">
      <div className="p-2 border-b border-line flex items-center gap-2">
        <div className="relative flex-1">
          <MagnifyingGlass size={15} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <input
            ref={inputRef}
            value={raw}
            aria-label="Search messages"
            onChange={(e) => { setRaw(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length); setAcOpen(true); }}
            onKeyDown={onKeyDown}
            onKeyUp={(e) => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) trackCaret(e); }}
            onClick={trackCaret}
            onBlur={() => { setTimeout(() => setAcOpen(false), 150); }}
            placeholder="Search"
            className="w-full pl-8 pr-2 py-1.5 rounded bg-surface-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {dropdownVisible && (
            <SearchSuggestions
              suggestions={suggestions}
              active={activeIdx}
              onHover={setActiveIdx}
              onPick={acceptSuggestion}
            />
          )}
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
