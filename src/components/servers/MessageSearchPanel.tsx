"use client";

import { useEffect, useRef } from "react";
import type { MessageSearch } from "@/components/servers/useMessageSearch";
import { SearchSuggestions } from "@/components/servers/SearchSuggestions";
import { Pagination } from "@/components/servers/Pagination";
import { Avatar } from "@/components/user/Avatar";
import { MagnifyingGlass, Hash } from "@phosphor-icons/react";
import { EmptyState } from "@/components/ui/EmptyState";

/** Always-visible search input for the channel header (right of the Members button). */
export function SearchBox({ search }: { search: MessageSearch }) {
  // Destructure up front: the hook result carries `inputRef`, and reading other fields off the
  // same object during render trips the React Compiler's refs rule.
  const {
    inputRef, raw, onChange, onKeyDown, onKeyUp, onClick, onBlur,
    dropdownVisible, suggestions, activeIdx, setActiveIdx, acceptSuggestion,
  } = search;
  return (
    <div className="relative ml-3 w-48">
      <MagnifyingGlass size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
      <input
        ref={inputRef}
        value={raw}
        aria-label="Search messages"
        onChange={onChange}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onClick={onClick}
        onBlur={onBlur}
        placeholder="Search"
        className="w-full pl-7 pr-2 py-1 rounded-row bg-surface-2 text-meta font-normal text-ink placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
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
  );
}

/** Results list, shown in the right-hand slot (shares the Members panel's place) while a query is active. */
export function SearchResultsPanel({ search }: { search: MessageSearch }) {
  const { results, busy, error, page, totalPages, total, goToPage, jumpTo } = search;
  const scrollRef = useRef<HTMLDivElement>(null);
  // Jump back to the top of the list when the page changes.
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [page]);

  return (
    <aside className="w-80 bg-sidebar border-l border-line flex flex-col">
      <div className="p-3 text-title font-semibold text-ink tracking-tight border-b border-line flex items-baseline justify-between">
        <span>Search results</span>
        {total > 0 && <span className="text-meta font-normal text-muted">{total} found</span>}
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
        {error && <p className="text-danger text-meta p-2">{error}</p>}
        {!busy && !error && results.length === 0 && (
          <EmptyState
            icon={<MagnifyingGlass size={28} weight="bold" aria-hidden="true" />}
            title="No results"
            description="Nothing matched that search. Try different words or filters."
          />
        )}
        {results.map((r) => (
          <button
            key={r.id}
            onClick={() => jumpTo(r)}
            className="text-left p-2 rounded-row hover:bg-surface flex flex-col gap-1"
          >
            <span className="flex items-center gap-1.5 text-meta text-muted">
              <Avatar url={r.author_avatar_url} name={r.author_display_name} size="sm" />
              <span className="text-ink font-medium">{r.author_display_name}</span>
              <Hash size={11} />{r.channel_name}
              <span className="ml-auto">{new Date(r.created_at).toLocaleDateString()}</span>
            </span>
            <span className="text-body text-ink line-clamp-3">
              {r.content || (r.image_url ? "🖼️ image" : r.file_name ? `📎 ${r.file_name}` : "")}
            </span>
          </button>
        ))}
      </div>
      {totalPages > 1 && (
        <div className="border-t border-line">
          <Pagination page={page} totalPages={totalPages} onChange={goToPage} />
        </div>
      )}
    </aside>
  );
}
