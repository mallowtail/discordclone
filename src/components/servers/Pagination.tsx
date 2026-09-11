"use client";

import { CaretLeft, CaretRight } from "@phosphor-icons/react";

// Page numbers to show: always 1 and the last page, plus the current page and its neighbours,
// with "…" filling any gap (e.g. 1 … 4 5 6 … 400).
function pageItems(page: number, totalPages: number): (number | "ellipsis")[] {
  const wanted = new Set<number>();
  for (const p of [1, totalPages, page - 1, page, page + 1]) {
    if (p >= 1 && p <= totalPages) wanted.add(p);
  }
  const sorted = [...wanted].sort((a, b) => a - b);
  const out: (number | "ellipsis")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) out.push("ellipsis");
    out.push(p);
    prev = p;
  }
  return out;
}

export function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  const items = pageItems(page, totalPages);

  return (
    <nav className="flex items-center justify-center gap-1 py-2 text-xs" aria-label="Search result pages">
      <button
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
        className="flex h-6 w-6 items-center justify-center rounded text-muted hover:text-ink hover:bg-surface disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted"
      >
        <CaretLeft size={13} weight="bold" />
      </button>
      {items.map((it, i) =>
        it === "ellipsis" ? (
          <span key={`e${i}`} className="px-1 text-muted select-none">…</span>
        ) : (
          <button
            key={it}
            onClick={() => onChange(it)}
            aria-current={it === page ? "page" : undefined}
            className={`h-6 min-w-6 px-1.5 rounded-full ${
              it === page ? "bg-accent text-white font-semibold" : "text-muted hover:text-ink hover:bg-surface"
            }`}
          >
            {it}
          </button>
        )
      )}
      <button
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        aria-label="Next page"
        className="flex h-6 w-6 items-center justify-center rounded text-muted hover:text-ink hover:bg-surface disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted"
      >
        <CaretRight size={13} weight="bold" />
      </button>
    </nav>
  );
}
