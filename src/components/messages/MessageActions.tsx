"use client";

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
    <div className="absolute right-2 top-0 hidden group-hover:flex gap-1 bg-surface rounded-lg border border-line px-1 py-0.5 text-sm">
      <button onClick={onReply} title="Reply" className="text-muted hover:text-ink">↩️</button>
      <button onClick={onPin} title={pinned ? "Unpin" : "Pin"} className="text-muted hover:text-ink">📌</button>
      {canEdit && (
        <>
          <button onClick={onEdit} title="Edit" className="text-muted hover:text-ink">✏️</button>
          <button onClick={onDelete} title="Delete" className="text-muted hover:text-ink">🗑️</button>
        </>
      )}
    </div>
  );
}
