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

  useEffect(() => { rawRef.current = raw; }, [raw]);

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

  // Debounced fresh search whenever the query changes. Empty query → no request.
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
      if (rawRef.current === q) { setResults((prev) => [...prev, ...rows]); setDone(rows.length < PAGE); }
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

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    setRaw(e.target.value);
    setCaret(e.target.selectionStart ?? e.target.value.length);
    setAcOpen(true);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (dropdownVisible) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((a) => (a + 1) % suggestions.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((a) => (a - 1 + suggestions.length) % suggestions.length); return; }
      if (e.key === "Tab") {
        const s = suggestions[activeIdx];
        if (s && s.selectable !== false) { e.preventDefault(); acceptSuggestion(s.value); }
        return;
      }
      if (e.key === "Enter") {
        // A bare word (operator suggestions) stays searchable text — Enter runs the search,
        // it must NOT turn "d" into "during:". You commit to an operator by typing its ":" or
        // clicking / Tab-ing the suggestion. Enter still accepts a concrete value (member, etc.).
        if (kind === "operator") { e.preventDefault(); setAcOpen(false); return; }
        const s = suggestions[activeIdx];
        if (s && s.selectable !== false) { e.preventDefault(); acceptSuggestion(s.value); }
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); setAcOpen(false); return; }
      return;
    }
    // Dropdown closed: Escape clears the query (hides the results panel) and drops focus.
    if (e.key === "Escape") { e.preventDefault(); if (raw) setRaw(""); inputRef.current?.blur(); }
  }

  function onKeyUp(e: React.KeyboardEvent<HTMLInputElement>) {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) trackCaret(e);
  }

  function onBlur() { setTimeout(() => setAcOpen(false), 150); }

  return {
    raw, results, busy, error, done, inputRef,
    suggestions, activeIdx, setActiveIdx, dropdownVisible, acceptSuggestion,
    loadMore, jumpTo,
    onChange, onKeyDown, onKeyUp, onClick: trackCaret, onBlur,
  };
}

export type MessageSearch = ReturnType<typeof useMessageSearch>;
