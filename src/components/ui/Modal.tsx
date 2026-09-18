"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "@phosphor-icons/react";
import { pushOverlay, popOverlay, isTopOverlay } from "@/components/ui/overlayStack";

const SIZE_CLASSES = {
  sm: "w-[min(92vw,24rem)]",
  md: "w-[min(92vw,32rem)]",
  lg: "w-[min(92vw,56rem)]",
} as const;

const HEIGHT_CLASSES = {
  auto: "max-h-[85vh]",
  // A definite height, not just a ceiling — lets a `h-full` child (e.g. a two-column layout
  // that needs its right column to stretch) actually fill the panel instead of collapsing to
  // its content's intrinsic height. Matches FullProfileModal's original fixed `h-[85vh]
  // max-h-[680px]` wrapper.
  tall: "h-[85vh] max-h-[680px]",
} as const;

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Centered dialog rendered into document.body. Handles focus trap/restore, Escape, backdrop
 * mousedown-to-close, and body scroll lock. `title` is optional so callers with a fully custom
 * header (e.g. an inline close button over unrelated content) can omit it and manage their own
 * in-panel affordances.
 */
export function Modal({
  onClose,
  title,
  size = "md",
  height = "auto",
  children,
}: {
  onClose: () => void;
  title?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** "auto" (default) shrinks to content, capped at 85vh. "tall" gives the panel a definite
   * height (85vh, capped at 680px) instead of just a ceiling — needed when a child relies on
   * `h-full` to stretch (a definite-height ancestor `max-height` alone doesn't provide). */
  height?: "auto" | "tall";
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Captured during render (the lazy useState initializer runs synchronously as part of this
  // component's first render, before React commits anything — including before commit-phase
  // autoFocus on a child like ConfirmDialog's confirm button can move focus). Reading
  // document.activeElement here, rather than inside the effect below, is what makes this the
  // trigger element and not a descendant of this panel that's about to unmount.
  const [previouslyFocused] = useState<HTMLElement | null>(() => document.activeElement as HTMLElement | null);

  useEffect(() => {
    const token = pushOverlay();
    const panel = panelRef.current;

    // Respect a child's own autoFocus (e.g. ConfirmDialog's confirm button); only fall back to
    // focusing the first focusable element (or the panel itself) if nothing inside already has focus.
    if (panel && !panel.contains(document.activeElement)) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? panel).focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // Only the topmost overlay closes — otherwise a ConfirmDialog opened on top of an
        // already-open Modal would close both on one Escape press.
        if (isTopOverlay(token)) onClose();
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

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      popOverlay(token);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose, previouslyFocused]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-overlay-in"
      onMouseDown={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        className={`flex ${SIZE_CLASSES[size]} ${HEIGHT_CLASSES[height]} flex-col overflow-hidden rounded-modal border border-line bg-surface shadow-2xl animate-panel-in`}
      >
        {title && (
          <div className="flex flex-none items-center justify-between gap-4 border-b border-line px-5 py-4">
            <h2 id={titleId} className="text-title font-semibold text-ink">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-7 w-7 flex-none items-center justify-center rounded-pill text-muted hover:bg-surface-2 hover:text-ink"
            >
              <X size={16} weight="bold" aria-hidden="true" />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body
  );
}
