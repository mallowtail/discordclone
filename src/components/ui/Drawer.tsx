"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { pushOverlay, popOverlay, isTopOverlay, claimEscape } from "@/components/ui/overlayStack";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Left-anchored slide-over for below the `md` breakpoint. Same focus-trap/Escape/scroll-lock
 * contract as Modal; slides in from `-translate-x-full` to `translate-x-0` via a scoped keyframe
 * (mirrors the overlay-in/panel-in pattern in globals.css, kept local here since this task
 * doesn't touch globals.css), disabled under `prefers-reduced-motion` — that central rule only
 * covers .animate-overlay-in/.animate-panel-in, not this transition.
 *
 * `Drawer` itself is a thin gate: unlike Modal (which has no `open` prop and is only ever
 * mounted by its caller while open), `Drawer` takes `open` and manages mount/unmount internally,
 * so the same `<Drawer open={open} .../>` element can sit persistently in a parent's JSX.
 * Rendering happens in the inner `DrawerPanel`, which — because the `open && <DrawerPanel/>`
 * below gives it a fresh component instance every time the drawer opens — gets a fresh
 * `useState` lazy initializer each open, exactly like Modal, so "focus captured before this
 * panel's children can move it via autoFocus" holds here too.
 */
export function Drawer({
  open,
  onClose,
  children,
  label,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  label: string;
}) {
  if (!open) return null;
  return (
    <DrawerPanel onClose={onClose} label={label}>
      {children}
    </DrawerPanel>
  );
}

function DrawerPanel({
  onClose,
  children,
  label,
}: {
  onClose: () => void;
  children: ReactNode;
  label: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // See the comment on Drawer above: this instance is freshly mounted each time the drawer
  // opens, so this lazy initializer — which runs during render, before commit-phase autoFocus
  // on a child can move focus — correctly captures the trigger element every time.
  const [previouslyFocused] = useState<HTMLElement | null>(() => document.activeElement as HTMLElement | null);

  // Latest onClose, so callers passing an inline closure don't re-run the overlay effect (which
  // would reset focus and re-push this overlay to the top of the stack on every parent render).
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
        // Only the topmost overlay closes — otherwise a Drawer open under a Modal (or vice
        // versa) would close both on one Escape press.
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

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      popOverlay(token);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus();
    };
  }, [previouslyFocused]);

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm animate-overlay-in" onMouseDown={onClose}>
      <style>{`
        @keyframes drawer-slide-in {
          from { transform: translateX(-100%); }
          to { transform: translateX(0); }
        }
        .drawer-panel {
          animation: drawer-slide-in 200ms ease-out;
        }
        @media (prefers-reduced-motion: reduce) {
          .drawer-panel {
            animation: none;
          }
        }
      `}</style>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        className="drawer-panel h-full w-[min(88vw,20rem)] overflow-y-auto border-r border-line bg-surface shadow-2xl"
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
