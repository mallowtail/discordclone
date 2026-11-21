"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSafety } from "@/components/providers/SafetyProvider";
import { useTopmostEscape } from "@/components/ui/overlayStack";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ReportDialog } from "@/components/reports/ReportDialog";
import { DotsThree } from "@phosphor-icons/react";

/** The "⋯" menu on someone's profile: Ignore / Block (or undo them) and Report user. Only shown for
 *  other people's live accounts (the profile views hide it for yourself and deleted/banned accounts). */
export function SafetyMenu({ userId, name }: { userId: string; name: string }) {
  const { kindOf, setKind, clear } = useSafety();
  const kind = kindOf(userId);
  const [open, setOpen] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  useTopmostEscape(open, () => setOpen(false));

  async function run(action: () => Promise<string | null>) {
    setOpen(false);
    setError(await action());
  }

  const item = "w-full min-h-11 md:min-h-0 px-3 py-1.5 text-left text-sm hover:bg-surface-2";

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={(e) => {
        // Drawn on top of everything (fixed, in a portal) so a card or panel edge can't clip it.
        const r = e.currentTarget.getBoundingClientRect();
        setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.right - 176, window.innerWidth - 184)) });
        setOpen((o) => !o);
      }} aria-label={`More options for ${name}`} aria-expanded={open}
        title="More"
        className="flex items-center justify-center w-11 h-11 md:w-8 md:h-8 rounded-control border border-line text-muted hover:text-ink hover:bg-surface-2">
        <DotsThree size={18} weight="bold" aria-hidden="true" />
      </button>
      {open && pos && createPortal(
        <div ref={menuRef} role="menu" data-keep-popover style={{ position: "fixed", top: pos.top, left: pos.left }}
          className="z-[60] w-44 rounded-xl border border-line bg-surface py-1 shadow-lg">
          {kind === "block" ? (
            <button type="button" role="menuitem" className={`${item} text-ink`} onClick={() => run(() => clear(userId))}>Unblock</button>
          ) : (
            <>
              {kind === "ignore" ? (
                <button type="button" role="menuitem" className={`${item} text-ink`} onClick={() => run(() => clear(userId))}>Unignore</button>
              ) : (
                <button type="button" role="menuitem" className={`${item} text-ink`} onClick={() => run(() => setKind(userId, "ignore"))}>Ignore</button>
              )}
              <button type="button" role="menuitem" className={`${item} text-danger`} onClick={() => { setOpen(false); setConfirmBlock(true); }}>Block</button>
            </>
          )}
          <button type="button" role="menuitem" className={`${item} text-danger`} onClick={() => { setOpen(false); setReporting(true); }}>Report user</button>
        </div>,
        document.body
      )}
      {error && <p role="alert" className="absolute right-0 top-full mt-1 w-44 text-meta text-danger">{error}</p>}
      {reporting && <ReportDialog kind="user" targetId={userId} onClose={() => setReporting(false)} />}
      {confirmBlock && (
        <ConfirmDialog
          title={`Block ${name}?`}
          message="They won't be able to message you, send you friend requests or add you to group chats, and you won't see their messages unless you choose to. If you're friends, that will be removed. They won't be told."
          confirmLabel="Block"
          destructive
          onConfirm={() => { setConfirmBlock(false); run(() => setKind(userId, "block")); }}
          onClose={() => setConfirmBlock(false)}
        />
      )}
    </div>
  );
}
