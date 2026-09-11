"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseSearchQuery } from "@/lib/searchQuery";
import { searchMessages } from "@/lib/search";
import { applySuggestion } from "@/lib/searchSuggest";
import { getSuggestions, type Member, type Channel } from "@/components/servers/SearchSuggestions";
import type { SearchResult } from "@/types/db";

const PAGE = 25;

/**
 * All message-search state + behavior for a server. Lives in a hook so the always-visible
 * header search box and the results panel (rendered in the members slot) can share one source
 * of truth without prop-drilling or duplicate derivation.
 */
export function useMessageSearch(serverId: string) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const pathname = usePathname();
  const [raw, setRaw] = useState("");       // live input value (drives autocomplete)
  const [query, setQuery] = useState("");   // committed search term — set only on Enter
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);     // 1-based current results page
  const [total, setTotal] = useState(0);   // total matches for the committed query
  const inputRef = useRef<HTMLInputElement>(null);

  const [members, setMembers] = useState<Member[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [caret, setCaret] = useState(0);
  const [acOpen, setAcOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [prevToken, setPrevToken] = useState("");


  // Fetch server members + channels once (mirrors MembersPanel / ForwardDialog) for autocomplete.
  useEffect(() => {
    let active = true;
    (async () => {
      const { data: m } = await supabase
        .from("server_members").select("profiles(id, username, display_name, avatar_url)").eq("server_id", serverId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (active) setMembers(((m ?? []) as any[]).map((r) => r.profiles).filter(Boolean));
      const { data: c } = await supabase.from("channels").select("id, name").eq("server_id", serverId).order("position");
      if (active) setChannels((c as Channel[]) ?? []);
    })();
    return () => { active = false; };
  }, [supabase, serverId]);

  const { kind, token, suggestions } = useMemo(
    () => getSuggestions(raw, caret, members, channels),
    [raw, caret, members, channels]
  );
  // Reset the highlighted row whenever the active token changes (adjusting state during render,
  // per React's guidance, instead of an effect — avoids an extra render pass).
  if (token !== prevToken) { setPrevToken(token); setActiveIdx(0); }
  const dropdownVisible = acOpen && suggestions.length > 0;

  // Fetch the current page of the COMMITTED query (set on Enter) — never on every keystroke.
  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults([]); setError(null); setTotal(0); return; }
    let active = true;
    (async () => {
      setBusy(true); setError(null);
      try {
        const rows = await searchMessages(supabase, serverId, parseSearchQuery(query), { lim: PAGE, off: (page - 1) * PAGE });
        if (active) { setResults(rows); setTotal(rows[0]?.total_count ?? 0); }
      } catch { if (active) setError("Search failed"); }
      finally { if (active) setBusy(false); }
    })();
    return () => { active = false; };
  }, [query, page, serverId, supabase]);

  // Commit the current input as the search to run (called on Enter); always resets to page 1.
  function runSearch() { setAcOpen(false); setPage(1); setQuery(raw); }

  const totalPages = Math.max(1, Math.ceil(total / PAGE));
  function goToPage(p: number) { setPage(Math.min(Math.max(1, p), totalPages)); }

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

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    setRaw(e.target.value);
    setCaret(e.target.selectionStart ?? e.target.value.length);
    setAcOpen(true);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (dropdownVisible) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((a) => (a + 1) % suggestions.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((a) => (a - 1 + suggestions.length) % suggestions.length); return; }
      if (e.key === "Enter") {
        // Enter autofills ONLY when picking a parameter value — a person (from:/mentions:), a
        // channel (in:), or a has:/pinned: value — navigable with the arrow keys. For a plain
        // word or an operator name, Enter runs the search instead; those fill in only on click.
        const isValueKind =
          kind === "from" || kind === "mentions" || kind === "in" || kind === "has" || kind === "pinned";
        const s = suggestions[activeIdx];
        if (isValueKind && s && s.selectable !== false) { e.preventDefault(); acceptSuggestion(s.value); return; }
        e.preventDefault(); runSearch(); return;
      }
      // Tab is intentionally NOT an autofill key — it tabs out of the field as usual.
      if (e.key === "Escape") { e.preventDefault(); setAcOpen(false); return; }
      return;
    }
    // Dropdown closed:
    if (e.key === "Enter") { e.preventDefault(); runSearch(); return; }
    // Escape clears the query (hides the results panel) and drops focus.
    if (e.key === "Escape") { e.preventDefault(); setRaw(""); setQuery(""); inputRef.current?.blur(); }
  }

  function onKeyUp(e: React.KeyboardEvent<HTMLInputElement>) {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) trackCaret(e);
  }

  function onBlur() { setTimeout(() => setAcOpen(false), 150); }

  return {
    raw, query, results, busy, error, inputRef,
    page, totalPages, total, goToPage,
    suggestions, activeIdx, setActiveIdx, dropdownVisible, acceptSuggestion,
    jumpTo,
    onChange, onKeyDown, onKeyUp, onClick: trackCaret, onBlur,
  };
}

export type MessageSearch = ReturnType<typeof useMessageSearch>;
