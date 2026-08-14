"use client";

import { useEffect, useRef, useState } from "react";
import EmojiPicker, { Theme } from "emoji-picker-react";
import {
  ArrowBendUpLeft,
  PushPin,
  PencilSimple,
  Trash,
  Smiley,
  DotsThree,
} from "@phosphor-icons/react";

export function MessageActions({
  recents,
  onReact,
  onReply,
  onPin,
  pinned,
  canEdit,
  onEdit,
  onDelete,
}: {
  recents: string[];
  onReact: (emoji: string) => void;
  onReply: () => void;
  onPin: () => void;
  pinned: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = pickerOpen || menuOpen;

  useEffect(() => {
    if (!pickerOpen) return;
    function onDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPickerOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pickerOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <div
      className={`absolute right-2 top-0 ${
        open ? "flex" : "hidden group-hover:flex"
      } items-center gap-1 bg-surface rounded-xl border border-line px-1 py-0.5 text-sm`}
    >
      {recents.map((e) => (
        <button
          key={e}
          onClick={() => onReact(e)}
          title={`React ${e}`}
          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-2 text-base leading-none"
        >
          {e}
        </button>
      ))}

      <span className="mx-0.5 w-px self-stretch bg-line" />

      <div className="relative" ref={pickerRef}>
        <button
          onClick={() => { setPickerOpen((o) => !o); setMenuOpen(false); }}
          title="Pick an emoji"
          aria-label="Pick an emoji"
          className="text-muted hover:text-ink w-7 h-7 flex items-center justify-center"
        >
          <Smiley size={18} />
        </button>
        {pickerOpen && (
          <div className="absolute top-full right-0 mt-2 z-30">
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
        onClick={onReply}
        title="Reply"
        aria-label="Reply"
        className="text-muted hover:text-ink w-7 h-7 flex items-center justify-center"
      >
        <ArrowBendUpLeft size={16} weight="bold" />
      </button>

      <div className="relative" ref={menuRef}>
        <button
          onClick={() => { setMenuOpen((o) => !o); setPickerOpen(false); }}
          title="More"
          aria-label="More"
          className="text-muted hover:text-ink w-7 h-7 flex items-center justify-center"
        >
          <DotsThree size={18} weight="bold" />
        </button>
        {menuOpen && (
          <div className="absolute top-full right-0 mt-2 z-20 w-40 rounded-xl border border-line bg-surface shadow-lg py-1">
            <button
              onClick={() => { setMenuOpen(false); onPin(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-ink hover:bg-surface-2 text-left"
            >
              <PushPin size={15} /> {pinned ? "Unpin" : "Pin"}
            </button>
            {canEdit && (
              <>
                <button
                  onClick={() => { setMenuOpen(false); onEdit(); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-ink hover:bg-surface-2 text-left"
                >
                  <PencilSimple size={15} /> Edit
                </button>
                <button
                  onClick={() => { setMenuOpen(false); onDelete(); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-danger hover:bg-surface-2 text-left"
                >
                  <Trash size={15} /> Delete
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
