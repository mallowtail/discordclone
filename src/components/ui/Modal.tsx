"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "@phosphor-icons/react";

const SIZE_CLASSES = {
  sm: "w-[min(92vw,24rem)]",
  md: "w-[min(92vw,32rem)]",
  lg: "w-[min(92vw,56rem)]",
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
  children,
}: {
  onClose: () => void;
  title?: ReactNode;
  size?: "sm" | "md" | "lg";
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;

    // Respect a child's own autoFocus (e.g. ConfirmDialog's confirm button); only fall back to
    // focusing the first focusable element (or the panel itself) if nothing inside already has focus.
    if (panel && !panel.contains(document.activeElement)) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? panel).focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
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
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose]);

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
        className={`flex ${SIZE_CLASSES[size]} max-h-[85vh] flex-col overflow-hidden rounded-modal border border-line bg-surface shadow-2xl animate-panel-in`}
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
