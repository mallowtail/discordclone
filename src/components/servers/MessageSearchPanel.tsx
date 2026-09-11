"use client";

import type { MessageSearch } from "@/components/servers/useMessageSearch";
import { SearchSuggestions } from "@/components/servers/SearchSuggestions";
import { Avatar } from "@/components/user/Avatar";
import { MagnifyingGlass, Hash } from "@phosphor-icons/react";

/** Always-visible search input for the channel header (right of the Members button). */
export function SearchBox({ search }: { search: MessageSearch }) {
  return (
    <div className="relative ml-3 w-48">
      <MagnifyingGlass size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
      <input
        ref={search.inputRef}
        value={search.raw}
        aria-label="Search messages"
        onChange={search.onChange}
        onKeyDown={search.onKeyDown}
        onKeyUp={search.onKeyUp}
        onClick={search.onClick}
        onBlur={search.onBlur}
        placeholder="Search"
        className="w-full pl-7 pr-2 py-1 rounded bg-surface-2 text-xs font-normal text-ink placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
      />
      {search.dropdownVisible && (
        <SearchSuggestions
          suggestions={search.suggestions}
          active={search.activeIdx}
          onHover={search.setActiveIdx}
          onPick={search.acceptSuggestion}
        />
      )}
    </div>
  );
}

/** Results list, shown in the right-hand slot (shares the Members panel's place) while a query is active. */
export function SearchResultsPanel({ search }: { search: MessageSearch }) {
  const { results, busy, error, done, loadMore, jumpTo } = search;
  return (
    <aside className="w-72 bg-sidebar border-l border-line flex flex-col">
      <div className="p-3 text-sm font-semibold text-ink tracking-tight border-b border-line">Search results</div>
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
        {error && <p className="text-danger text-xs p-2">{error}</p>}
        {!busy && !error && results.length === 0 && <p className="text-muted text-xs p-2">No results.</p>}
        {results.map((r) => (
          <button
            key={r.id}
            onClick={() => jumpTo(r)}
            className="text-left p-2 rounded hover:bg-surface flex flex-col gap-1"
          >
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
          <button
            onClick={loadMore}
            disabled={busy}
            className="text-xs text-accent hover:underline p-2 disabled:opacity-50"
          >
            {busy ? "Loading…" : "Load more"}
          </button>
        )}
      </div>
    </aside>
  );
}
