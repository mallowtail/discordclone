"use client";

import { useState } from "react";
import { removeReturnedFiles } from "@/components/admin/adminActions";
import { filesLeftMessage, type StorageFileRow } from "@/lib/admin/admin";

/**
 * "…its file couldn't be removed — try again" with a Retry button, for files a deletion left in
 * Storage. The parent keeps the list (so it survives the deleted row leaving the screen) and gets
 * the new, shorter list after each retry; nothing shows once it's empty.
 */
export function FilesLeftNotice({ files, what, onChange }: {
  files: StorageFileRow[];
  what: "message" | "server" | "ban";
  onChange: (left: StorageFileRow[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  if (files.length === 0) return null;

  async function retry() {
    setBusy(true);
    const left = await removeReturnedFiles(files);
    setBusy(false);
    onChange(left);
  }

  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 text-meta text-danger">
      <span>{filesLeftMessage(what)}</span>
      <button type="button" onClick={retry} disabled={busy}
        className="rounded-control border border-line px-3 py-1.5 min-h-11 md:min-h-0 text-meta font-medium text-ink hover:bg-surface-2 disabled:opacity-50">
        {busy ? "Trying…" : "Try again"}
      </button>
    </div>
  );
}
