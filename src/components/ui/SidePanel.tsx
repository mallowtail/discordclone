"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { pushOverlay, popOverlay, isTopOverlay, claimEscape } from "@/components/ui/overlayStack";

// Shared by the channel and group-chat pages: the header's icon buttons, and the right-hand side
// panel (members) that is an inline column at `xl`+ and an overlay below it.

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Whether right-hand side panels act as overlays (below `xl`) rather than inline columns (`xl`+).
 * Tracked in JS, not just CSS, because the overlay-only accessibility behavior (focus trap,
 * Escape, dialog semantics) must not apply to the inline column.
 */
export function useOverlayMode() {
  const [overlayMode, setOverlayMode] = useState(() => typeof window !== "undefined" && window.innerWidth < 1280);
  // The lazy initializer gets the first render right; this only tracks later crossings of the
  // `xl` boundary via the media query's own change event (no synchronous setState in the effect).
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 1279px)");
    const onChange = (e: MediaQueryListEvent) => setOverlayMode(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return overlayMode;
}

export function HeaderButton({
  label,
  onClick,
  children,
  triggerId,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  triggerId?: string;
}) {
  return (
    <div className="group relative ml-3 flex items-center">
      <button
        onClick={onClick}
        aria-label={label}
        data-trigger={triggerId}
        className="flex items-center justify-center min-h-11 min-w-11 md:min-h-0 md:min-w-0 text-muted hover:text-ink"
      >
        {children}
      </button>
      <span
        className="pointer-events-none absolute left-1/2 top-full z-40 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-row
          border border-line bg-surface-2 px-2 py-1 text-meta leading-4 font-normal text-ink opacity-0 shadow-lg transition-opacity
          group-hover:opacity-100"
      >
        {label}
      </span>
    </div>
  );
}

/**
 * Below `xl` a side panel (server members, group members) is a genuinely new overlay (Task 7), not just a repositioned
 * panel — G10 binds every new overlay to Escape-to-close (scoped to the topmost one, via the
 * same `overlayStack` Modal/Drawer use), `role="dialog"` + `aria-modal`, and focus containment.
 * At `xl`+ this never mounts; `MembersPanel` renders bare, inline, no dialog semantics, because
 * it isn't acting as an overlay there (trapping focus in an always-visible inline column would
 * break normal keyboard flow into the chat/composer).
 */
export function SidePanelOverlay({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Captured once, at mount — same trick Drawer uses: the trigger (the header's "Show Member
  // List" button) is `document.activeElement` at the moment this mounts, since the user just
  // clicked it, so there's no need for a dedicated ref just to restore focus to it on close.
  const [previouslyFocused] = useState<HTMLElement | null>(() => document.activeElement as HTMLElement | null);

  // Latest onClose, so caller closure identity never re-runs the overlay effect (see Modal.tsx).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const token = pushOverlay();
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? panel).focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (isTopOverlay(token) && claimEscape(e)) onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null
      );
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);

    // Same scroll lock Drawer.tsx uses: without it the chat behind this dialog stays
    // scrollable while it's open, which is a half-built modal even though G10 doesn't name
    // scroll-locking specifically.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      popOverlay(token);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus();
    };
  }, [previouslyFocused]);

  return (
    <div ref={panelRef} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className="h-full">
      {children}
    </div>
  );
}
