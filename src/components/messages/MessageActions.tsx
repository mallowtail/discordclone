"use client";

import { useEffect, useRef, useState } from "react";
import { useTopmostEscape } from "@/components/ui/overlayStack";
import EmojiPicker, { Theme } from "emoji-picker-react";
import { useDrawer } from "@/components/providers/DrawerProvider";
import {
  ArrowBendUpLeft,
  ArrowBendUpRight,
  PushPin,
  PencilSimple,
  Trash,
  Smiley,
  DotsThree,
  DotsThreeVertical,
} from "@phosphor-icons/react";

export function MessageActions({
  recents,
  onReact,
  onReply,
  onForward,
  onPin,
  pinned,
  canEdit,
  onEdit,
  onDelete,
}: {
  recents: string[];
  onReact: (emoji: string) => void;
  onReply: () => void;
  onForward: () => void;
  onPin: () => void;
  pinned: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerUp, setPickerUp] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Below `md` the toolbar is hover-unreachable (no hover on touch), so it's gated behind the
  // persistent "more actions" trigger button rendered below instead.
  const [mobileOpen, setMobileOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const mobileRef = useRef<HTMLDivElement>(null);
  const open = pickerOpen || menuOpen || mobileOpen;
  const { isMobile } = useDrawer();

  // Reset the mobile toolbar when a resize carries the viewport to `md`+, so widening the
  // window without a remount can't leave it forced-visible at desktop widths until an outside
  // click. Mirrors DrawerProvider's own `isMobile` tracking: `setMobileOpen` is only ever
  // called from inside the media query's own `change` callback — a subscription callback, not
  // the effect body itself — which is the shape this repo's `react-hooks/set-state-in-effect`
  // rule accepts (an unconditional `setState` directly in the effect body, or mutating a ref
  // during render as an alternative, both trip it).
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");
    function onChange(e: MediaQueryListEvent) {
      if (!e.matches) setMobileOpen(false);
    }
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!pickerOpen) return;
    function onDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pickerOpen]);

  useTopmostEscape(pickerOpen, () => setPickerOpen(false));

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  useTopmostEscape(menuOpen, () => setMenuOpen(false));

  // The persistent mobile trigger's own outside-click/Escape dismissal — scoped to
  // `mobileRef`, which wraps the trigger button *and* the toolbar it reveals, so tapping
  // inside the revealed toolbar (e.g. to open the emoji picker) doesn't close it.
  useEffect(() => {
    if (!mobileOpen) return;
    function onDown(e: MouseEvent) {
      if (mobileRef.current && !mobileRef.current.contains(e.target as Node)) setMobileOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [mobileOpen]);

  useTopmostEscape(mobileOpen, () => setMobileOpen(false));

  return (
    <div ref={mobileRef} className="absolute right-2 top-0 flex items-center">
      {/* Persistent trigger: the toolbar below is hover-only and therefore unreachable on
          touch, so below `md` this button is always visible (no group-hover needed) and
          reveals the same toolbar on tap. Hidden once the toolbar is open so the two don't
          stack on top of each other; irrelevant at `md`+, where hover already reveals it. */}
      <button
        onClick={() => setMobileOpen((o) => !o)}
        title="More actions"
        aria-label="More actions"
        aria-haspopup="true"
        aria-expanded={mobileOpen}
        className={`md:hidden ${mobileOpen ? "hidden" : "flex"} items-center justify-center w-11 h-11 rounded-control border border-line bg-surface text-muted hover:text-ink`}
      >
        <DotsThreeVertical size={20} weight="bold" aria-hidden="true" />
      </button>

      <div
        className={`items-center gap-1 bg-surface rounded-xl border border-line px-1 py-0.5 text-sm ${
          open ? "flex" : "hidden group-hover:flex"
        }`}
      >
        {recents.map((e) => (
          <button
            key={e}
            onClick={() => { setMobileOpen(false); onReact(e); }}
            title={`React ${e}`}
            className="w-11 h-11 md:w-7 md:h-7 flex items-center justify-center rounded-lg hover:bg-surface-2 text-base leading-none"
          >
            {e}
          </button>
        ))}

        <span className="mx-0.5 w-px self-stretch bg-line" />

        <div className="relative" ref={pickerRef}>
          <button
            onClick={() => {
              setPickerOpen((o) => {
                const next = !o;
                if (next) {
                  const rect = pickerRef.current?.getBoundingClientRect();
                  // EmojiPicker is ~450px tall; open upward if not enough room below.
                  setPickerUp(rect ? window.innerHeight - rect.bottom < 450 : false);
                }
                return next;
              });
              setMenuOpen(false);
            }}
            title="Pick an emoji"
            aria-label="Pick an emoji"
            className="text-muted hover:text-ink w-11 h-11 md:w-7 md:h-7 flex items-center justify-center"
          >
            <Smiley size={18} />
          </button>
          {pickerOpen && isMobile && (
            // Below `md`, the trigger can sit far enough off-center within the toolbar that
            // anchoring the picker to it (as the `md`+ branch does) would push a
            // viewport-width-constrained picker past the screen edge. Centering it as a
            // lightweight overlay instead sidesteps that regardless of where the trigger is.
            <div
              className="fixed inset-0 z-30 flex items-center justify-center p-4"
              onMouseDown={() => setPickerOpen(false)}
            >
              <div onMouseDown={(e) => e.stopPropagation()}>
                <EmojiPicker
                  theme={Theme.DARK}
                  onEmojiClick={(d) => { onReact(d.emoji); setPickerOpen(false); setMobileOpen(false); }}
                  lazyLoadEmojis
                  skinTonesDisabled
                  width="min(90vw, 350px)"
                  height="min(60vh, 450px)"
                />
              </div>
            </div>
          )}
          {pickerOpen && !isMobile && (
            <div className={`absolute right-0 z-30 ${pickerUp ? "bottom-full mb-2" : "top-full mt-2"}`}>
              <EmojiPicker
                theme={Theme.DARK}
                onEmojiClick={(d) => { onReact(d.emoji); setPickerOpen(false); }}
                lazyLoadEmojis
                skinTonesDisabled
              />
            </div>
          )}
        </div>

        <button
          onClick={() => { setMobileOpen(false); onReply(); }}
          title="Reply"
          aria-label="Reply"
          className="text-muted hover:text-ink w-11 h-11 md:w-7 md:h-7 flex items-center justify-center"
        >
          <ArrowBendUpLeft size={16} weight="bold" />
        </button>

        <button
          onClick={() => { setMobileOpen(false); onForward(); }}
          title="Forward"
          aria-label="Forward"
          className="text-muted hover:text-ink w-11 h-11 md:w-7 md:h-7 flex items-center justify-center"
        >
          <ArrowBendUpRight size={16} weight="bold" />
        </button>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => { setMenuOpen((o) => !o); setPickerOpen(false); }}
            title="More"
            aria-label="More"
            className="text-muted hover:text-ink w-11 h-11 md:w-7 md:h-7 flex items-center justify-center"
          >
            <DotsThree size={18} weight="bold" />
          </button>
          {menuOpen && (
            <div className="absolute top-full right-0 mt-2 z-20 w-40 rounded-xl border border-line bg-surface shadow-lg py-1">
              <button
                onClick={() => { setMenuOpen(false); setMobileOpen(false); onPin(); }}
                className="w-full min-h-11 md:min-h-0 flex items-center gap-2 px-3 py-1.5 text-sm text-ink hover:bg-surface-2 text-left"
              >
                <PushPin size={15} /> {pinned ? "Unpin" : "Pin"}
              </button>
              {canEdit && (
                <>
                  <button
                    onClick={() => { setMenuOpen(false); setMobileOpen(false); onEdit(); }}
                    className="w-full min-h-11 md:min-h-0 flex items-center gap-2 px-3 py-1.5 text-sm text-ink hover:bg-surface-2 text-left"
                  >
                    <PencilSimple size={15} /> Edit
                  </button>
                  <button
                    onClick={() => { setMenuOpen(false); setMobileOpen(false); onDelete(); }}
                    className="w-full min-h-11 md:min-h-0 flex items-center gap-2 px-3 py-1.5 text-sm text-danger hover:bg-surface-2 text-left"
                  >
                    <Trash size={15} /> Delete
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
