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
    <div className="absolute right-2 top-0 hidden group-hover:flex gap-1 bg-[#2b2d31] rounded px-1 py-0.5 text-sm">
      <button onClick={onReply} title="Reply" className="text-[#949ba4] hover:text-white">↩️</button>
      <button onClick={onPin} title={pinned ? "Unpin" : "Pin"} className="text-[#949ba4] hover:text-white">📌</button>
      {canEdit && (
        <>
          <button onClick={onEdit} title="Edit" className="text-[#949ba4] hover:text-white">✏️</button>
          <button onClick={onDelete} title="Delete" className="text-[#949ba4] hover:text-white">🗑️</button>
        </>
      )}
    </div>
  );
}
