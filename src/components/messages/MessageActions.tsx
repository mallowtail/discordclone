"use client";

import { ArrowBendUpLeft, PushPin, PencilSimple, Trash } from "@phosphor-icons/react";

export function MessageActions({
  onReply,
  onPin,
  pinned,
  canEdit,
  onEdit,
  onDelete,
}: {
  onReply: () => void;
  onPin: () => void;
  pinned: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="absolute right-2 top-0 hidden group-hover:flex gap-1 bg-surface rounded-xl border border-line px-1 py-0.5 text-sm">
      <button onClick={onReply} title="Reply" aria-label="Reply" className="text-muted hover:text-ink">
        <ArrowBendUpLeft size={14} weight="bold" />
      </button>
      <button onClick={onPin} title={pinned ? "Unpin" : "Pin"} aria-label={pinned ? "Unpin" : "Pin"} className="text-muted hover:text-ink">
        <PushPin size={15} />
      </button>
      {canEdit && (
        <>
          <button onClick={onEdit} title="Edit" aria-label="Edit" className="text-muted hover:text-ink">
            <PencilSimple size={14} />
          </button>
          <button onClick={onDelete} title="Delete" aria-label="Delete" className="text-muted hover:text-ink">
            <Trash size={14} />
          </button>
        </>
      )}
    </div>
  );
}
