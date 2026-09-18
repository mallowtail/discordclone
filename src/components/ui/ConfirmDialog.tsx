"use client";

import type { ReactNode } from "react";
import { Modal } from "@/components/ui/Modal";

/**
 * Confirmation dialog built on Modal — replaces native `confirm()`. The confirm button takes
 * initial focus (via autoFocus, which Modal's own focus-on-open defers to).
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onClose,
}: {
  title: ReactNode;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} title={title} size="sm">
      <div className="px-5 py-4">
        <p className="text-body text-muted">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-control px-4 py-2 text-body font-medium text-ink hover:bg-surface-2"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            className={`rounded-control px-4 py-2 text-body font-medium text-white ${
              destructive ? "bg-danger hover:bg-danger/90" : "bg-accent hover:bg-accent-strong"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
